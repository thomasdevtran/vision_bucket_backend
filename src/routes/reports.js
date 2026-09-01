const express = require('express');
const router = express.Router();
const { db, collection, doc, getDoc, getDocs, query, where, addDoc, updateDoc } = require('../firebase');
const { authenticate, requireRole } = require('../middleware/authenticate');
const {
  RESOLUTION_STATUSES,
  validateReportInput,
  targetExists,
  removeTarget,
  recordModerationAction
} = require('../data/moderation');

const REPORTS = 'reports';

// Moderator-only endpoints allow the same admin role the news feature gates on,
// plus a dedicated moderator role, checked through the shared requireRole helper.
const requireModerator = requireRole('admin', 'moderator');

// Drop internal-only fields when nothing needs hiding; reports carry no owner
// secret, but keeping a serializer makes the response shape explicit.
const serializeReport = (id, data) => ({
  id,
  reporterUid: data.reporterUid,
  targetType: data.targetType,
  targetId: data.targetId,
  reason: data.reason,
  status: data.status,
  createdAt: data.createdAt,
  resolvedBy: data.resolvedBy || null,
  resolvedAt: data.resolvedAt || null,
  resolution: data.resolution || null
});

// POST /reports - any authenticated user reports a piece of content.
router.post('/', authenticate, async (req, res) => {
  try {
    const validation = validateReportInput(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Invalid report', details: validation.errors });
    }
    const { targetType, targetId, reason } = validation.value;

    if (!(await targetExists(targetType, targetId))) {
      return res.status(404).json({ error: 'Reported content not found' });
    }

    // Prevent a user from stacking multiple open reports on the same target.
    // Chosen contract: 409 Conflict (documented in the feature notes).
    const existing = await getDocs(query(
      collection(db, REPORTS),
      where('reporterUid', '==', req.user.uid),
      where('targetType', '==', targetType),
      where('targetId', '==', targetId),
      where('status', '==', 'open')
    ));
    if (!existing.empty) {
      return res.status(409).json({ error: 'You already have an open report for this content' });
    }

    const newReport = {
      reporterUid: req.user.uid,
      targetType,
      targetId,
      reason,
      status: 'open',
      createdAt: new Date().toISOString(),
      resolvedBy: null,
      resolvedAt: null,
      resolution: null
    };
    const docRef = await addDoc(collection(db, REPORTS), newReport);
    res.status(201).json(serializeReport(docRef.id, newReport));
  } catch (error) {
    console.error('Error creating report:', error);
    res.status(500).json({ error: 'Failed to create report' });
  }
});

// GET /reports?status=open - moderators list reports, newest first.
router.get('/', authenticate, requireModerator, async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'open';
    if (!['open', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter' });
    }
    const snapshot = await getDocs(query(collection(db, REPORTS), where('status', '==', status)));
    const reports = snapshot.docs
      .map(reportDoc => serializeReport(reportDoc.id, reportDoc.data()))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    res.status(200).json({ status, reports });
  } catch (error) {
    console.error('Error listing reports:', error);
    res.status(500).json({ error: 'Failed to list reports' });
  }
});

// PATCH /reports/:id - moderators resolve or dismiss a report and, optionally,
// remove the offending content. An audit record is written either way.
router.patch('/:id', authenticate, requireModerator, async (req, res) => {
  try {
    const { status, removeTarget: shouldRemove } = req.body || {};
    if (!RESOLUTION_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${RESOLUTION_STATUSES.join(', ')}` });
    }
    if (shouldRemove !== undefined && typeof shouldRemove !== 'boolean') {
      return res.status(400).json({ error: 'removeTarget must be a boolean' });
    }

    const reportRef = doc(db, REPORTS, req.params.id);
    const reportSnap = await getDoc(reportRef);
    if (!reportSnap.exists()) {
      return res.status(404).json({ error: 'Report not found' });
    }
    const report = reportSnap.data();

    // Content is only removed on a resolve, never on a dismiss.
    const removeContent = shouldRemove === true && status === 'resolved';
    let removed = false;
    if (removeContent) {
      removed = await removeTarget(report.targetType, report.targetId);
    }

    const now = new Date().toISOString();
    const update = {
      status,
      resolvedBy: req.user.uid,
      resolvedAt: now,
      resolution: removed ? 'removed' : status
    };
    await updateDoc(reportRef, update);

    await recordModerationAction({
      moderatorUid: req.user.uid,
      action: removed ? 'remove_target' : status,
      targetType: report.targetType,
      targetId: report.targetId,
      reportId: req.params.id
    });

    res.status(200).json({
      ...serializeReport(req.params.id, { ...report, ...update }),
      removedTarget: removed
    });
  } catch (error) {
    console.error('Error updating report:', error);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

module.exports = router;
