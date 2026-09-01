const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { adminApp } = require('./firebaseAdmin');

const db = getFirestore(adminApp);

const collection = (database, name) => database.collection(name);
const doc = (databaseOrCollection, collectionName, id) => {
  if (typeof databaseOrCollection.doc === 'function' && collectionName === undefined) {
    return databaseOrCollection.doc();
  }
  return databaseOrCollection.collection(collectionName).doc(id);
};
const where = (field, operator, value) => ({ field, operator, value });
const query = (reference, ...constraints) => constraints.reduce(
  (current, constraint) => current.where(constraint.field, constraint.operator, constraint.value),
  reference
);
const getDocs = reference => reference.get();
const getDoc = async reference => {
  const snapshot = await reference.get();
  return {
    id: snapshot.id,
    exists: () => snapshot.exists,
    data: () => snapshot.data()
  };
};
const addDoc = (reference, data) => reference.add(data);
const updateDoc = (reference, data) => reference.update(data);
const setDoc = (reference, data, options) => options
  ? reference.set(data, options)
  : reference.set(data);
const deleteDoc = reference => reference.delete();
const arrayUnion = (...values) => FieldValue.arrayUnion(...values);
const arrayRemove = (...values) => FieldValue.arrayRemove(...values);
const runTransaction = updateFunction => db.runTransaction(updateFunction);
const checkFirestoreReady = () => db.listCollections();

module.exports = {
  db,
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  setDoc,
  deleteDoc,
  arrayUnion,
  arrayRemove,
  runTransaction,
  query,
  where,
  checkFirestoreReady
};
