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
const getDoc = reference => reference.get();
const addDoc = (reference, data) => reference.add(data);
const updateDoc = (reference, data) => reference.update(data);
const setDoc = (reference, data, options) => reference.set(data, options);
const deleteDoc = reference => reference.delete();
const arrayUnion = (...values) => FieldValue.arrayUnion(...values);
const arrayRemove = (...values) => FieldValue.arrayRemove(...values);

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
  query,
  where
};
