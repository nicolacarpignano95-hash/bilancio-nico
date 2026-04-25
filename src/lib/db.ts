import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  Timestamp,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth, OperationType, handleFirestoreError } from './firebase';
import { Movement, Investment, InvestmentIncrement, Loan, Tax } from '../types';

// Constants
const MOVEMENTS_COL = 'movements';
const INVESTMENTS_COL = 'investments';
const LOANS_COL = 'loans';
const TAXES_COL = 'taxes';

// Movements
export const addMovement = async (movement: Omit<Movement, 'id' | 'createdAt'>) => {
  try {
    const userId = auth.currentUser?.uid || 'default-nico-user';
    
    // Auto-calculate taxes if needed
    let taxAmount = 0;
    let netAmount = movement.amount;
    
    if (movement.type === 'income' && movement.paymentMethod === 'fatt') {
      // 25% taxes rule for Nico or Inlab-by-Nico-fatt
      if (movement.area === 'nico' || (movement.area === 'inlab' && movement.collectedBy === 'nico')) {
        taxAmount = movement.amount * 0.25;
        netAmount = movement.amount * 0.75;
      }
    }

    const docRef = await addDoc(collection(db, MOVEMENTS_COL), {
      ...movement,
      taxAmount,
      netAmount,
      userId,
      createdAt: serverTimestamp()
    });

    // If taxes generated, add to Tax collection
    if (taxAmount > 0) {
      await addTax({
        date: movement.date,
        origin: `Incasso ${movement.client || ''} (${movement.area})`,
        amount: taxAmount,
        status: 'accantonata',
        userId,
        notes: `Generata automaticamente da incasso di ${movement.amount}€`
      });
    }

    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, MOVEMENTS_COL);
  }
};

export const subscribeMovements = (callback: (movements: Movement[]) => void) => {
  const userId = auth.currentUser?.uid || 'default-nico-user';
  
  const q = query(
    collection(db, MOVEMENTS_COL),
    where('userId', '==', userId),
    orderBy('date', 'desc')
  );

  return onSnapshot(q, (snapshot) => {
    const movements = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Movement[];
    callback(movements);
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, MOVEMENTS_COL);
  });
};

// Taxes
export const addTax = async (tax: Omit<Tax, 'id'>) => {
  try {
    const userId = auth.currentUser?.uid || 'default-nico-user';
    const docRef = await addDoc(collection(db, TAXES_COL), {
      ...tax,
      userId,
      createdAt: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, TAXES_COL);
  }
};

export const subscribeTaxes = (callback: (taxes: Tax[]) => void) => {
  const userId = auth.currentUser?.uid || 'default-nico-user';
  
  const q = query(
    collection(db, TAXES_COL),
    where('userId', '==', userId),
    orderBy('date', 'desc')
  );

  return onSnapshot(q, (snapshot) => {
    const taxes = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Tax[];
    callback(taxes);
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, TAXES_COL);
  });
};

// Investments
export const addInvestment = async (investment: Omit<Investment, 'id'>) => {
  try {
    const userId = auth.currentUser?.uid || 'default-nico-user';
    const docRef = await addDoc(collection(db, INVESTMENTS_COL), {
      ...investment,
      userId,
      createdAt: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, INVESTMENTS_COL);
  }
};

export const updateInvestment = async (id: string, updates: Partial<Investment>) => {
  try {
    const docRef = doc(db, INVESTMENTS_COL, id);
    await updateDoc(docRef, updates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${INVESTMENTS_COL}/${id}`);
  }
};

export const subscribeInvestments = (callback: (investments: Investment[]) => void) => {
  const userId = auth.currentUser?.uid || 'default-nico-user';
  
  const q = query(
    collection(db, INVESTMENTS_COL),
    where('userId', '==', userId)
  );

  return onSnapshot(q, (snapshot) => {
    const investments = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Investment[];
    callback(investments);
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, INVESTMENTS_COL);
  });
};
