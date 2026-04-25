import { useState, useEffect, useMemo } from 'react';
import { subscribeMovements, subscribeInvestments, subscribeTaxes } from '../lib/db';
import { Movement, Investment, Tax, NicoStats, InlabStats } from '../types';
import { startOfMonth, isSameMonth, parseISO } from 'date-fns';

export function useFinance() {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsubMovements = subscribeMovements(setMovements);
    const unsubInvestments = subscribeInvestments(setInvestments);
    const unsubTaxes = subscribeTaxes(setTaxes);

    setLoading(false);

    return () => {
      unsubMovements();
      unsubInvestments();
      unsubTaxes();
    };
  }, []);

  const nicoStats = useMemo<NicoStats>(() => {
    const now = new Date();
    const monthMovements = movements.filter(m => isSameMonth(parseISO(m.date), now));
    const nicoMovements = monthMovements.filter(m => m.area === 'nico');
    
    const monthlyIncome = nicoMovements.filter(m => m.type === 'income').reduce((acc, m) => acc + m.amount, 0);
    const monthlyExpenses = nicoMovements.filter(m => m.type === 'expense').reduce((acc, m) => acc + m.amount, 0);
    const monthlyTaxes = taxes.filter(t => isSameMonth(parseISO(t.date), now)).reduce((acc, t) => acc + t.amount, 0);
    
    // Inlab share for Nico
    const monthInlabMovements = monthMovements.filter(m => m.area === 'inlab');
    const nicoInlabShare = monthInlabMovements.reduce((acc, m) => {
      if (m.type === 'income') {
        const profit = m.netAmount || m.amount;
        return acc + (profit * 0.5);
      } else {
        return acc - (m.amount * 0.5);
      }
    }, 0);

    const totalInvestments = investments.reduce((acc, inv) => acc + inv.currentValue, 0);

    return {
      monthlyIncome,
      monthlyExpenses,
      monthlyTaxes,
      netMonthly: monthlyIncome + nicoInlabShare - monthlyExpenses - monthlyTaxes,
      liquidity: 0, // Simplified for now
      totalWealth: totalInvestments, // Simplified
      totalInvestments
    };
  }, [movements, taxes, investments]);

  const inlabStats = useMemo<InlabStats>(() => {
    const now = new Date();
    const monthInlabMovements = movements.filter(m => m.area === 'inlab' && isSameMonth(parseISO(m.date), now));
    
    const monthlyGross = monthInlabMovements.filter(m => m.type === 'income').reduce((acc, m) => acc + m.amount, 0);
    const monthlyReal = monthInlabMovements.filter(m => m.type === 'income').reduce((acc, m) => acc + (m.netAmount || m.amount), 0);
    const monthlyExpenses = monthInlabMovements.filter(m => m.type === 'expense').reduce((acc, m) => acc + m.amount, 0);
    const monthlyProfit = monthlyReal - monthlyExpenses;
    
    const nicoShare = monthlyProfit * 0.5;
    const ilariaShare = monthlyProfit * 0.5;

    // Amounts given to partners
    const nicoReceived = monthInlabMovements.filter(m => m.type === 'income' && m.collectedBy === 'nico').reduce((acc, m) => acc + (m.netAmount || m.amount) * 0.5, 0);
    const ilariaReceived = monthInlabMovements.filter(m => m.type === 'income' && m.collectedBy === 'ilaria').reduce((acc, m) => acc + (m.netAmount || m.amount) * 0.5, 0);
    
    // Simplified logic: how much Nico received from Ilaria (or kept from his collections)
    const nicoActuallyReceived = monthInlabMovements.reduce((acc, m) => {
       if (m.type === 'income') {
          if (m.collectedBy === 'nico') return acc + (m.netAmount || m.amount) * 0.5;
          if (m.collectedBy === 'ilaria') return acc + (m.givenToPartner || 0);
       }
       return acc;
    }, 0);

    const ilariaActuallyReceived = monthInlabMovements.reduce((acc, m) => {
      if (m.type === 'income') {
         if (m.collectedBy === 'ilaria') return acc + (m.netAmount || m.amount) * 0.5;
         if (m.collectedBy === 'nico') return acc + (m.givenToPartner || 0);
      }
      return acc;
   }, 0);

    return {
      monthlyGross,
      monthlyReal,
      monthlyExpenses,
      monthlyProfit,
      nicoShare,
      ilariaShare,
      nicoReceived: nicoActuallyReceived,
      nicoPending: nicoShare - nicoActuallyReceived,
      ilariaReceived: ilariaActuallyReceived,
      ilariaPending: ilariaShare - ilariaActuallyReceived
    };
  }, [movements]);

  return { movements, investments, taxes, nicoStats, inlabStats, loading };
}
