export type AreaType = 'nico' | 'inlab';
export type MovementType = 'income' | 'expense';
export type PaymentMethod = 'contanti' | 'fatt';
export type CollectedBy = 'nico' | 'ilaria';
export type TaxStatus = 'accantonata' | 'pagata' | 'da pagare';

export interface Movement {
  id?: string;
  type: MovementType;
  area: AreaType;
  date: string;
  amount: number;
  grossAmount?: number;
  taxAmount?: number;
  netAmount?: number;
  description: string;
  category: string;
  paymentMethod?: PaymentMethod;
  account?: string;
  collectedBy?: CollectedBy;
  givenToPartner?: number;
  notes?: string;
  client?: string;
  userId: string;
  createdAt: string;
}

export interface Investment {
  id?: string;
  name: string;
  category: string;
  platform?: string;
  initialValue: number; // Jan 1st
  currentValue: number;
  userId: string;
}

export interface InvestmentIncrement {
  id?: string;
  investmentId: string;
  date: string;
  amount: number;
  notes?: string;
  userId: string;
}

export interface Loan {
  id?: string;
  name: string;
  initialAmount: number;
  residualAmount: number;
  installment: number;
  startDate: string;
  area: AreaType;
  notes?: string;
  userId: string;
}

export interface Tax {
  id?: string;
  date: string;
  origin: string;
  amount: number;
  status: TaxStatus;
  notes?: string;
  userId: string;
}

export interface NicoStats {
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyTaxes: number;
  netMonthly: number;
  liquidity: number;
  totalWealth: number;
  totalInvestments: number;
}

export interface InlabStats {
  monthlyGross: number;
  monthlyReal: number;
  monthlyExpenses: number;
  monthlyProfit: number;
  nicoShare: number;
  ilariaShare: number;
  nicoReceived: number;
  nicoPending: number;
  ilariaReceived: number;
  ilariaPending: number;
}
