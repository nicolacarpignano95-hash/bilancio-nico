import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Minus, X, ChevronRight, Check } from 'lucide-react';
import { AreaType, MovementType, PaymentMethod, CollectedBy } from '../types';
import { addMovement } from '../lib/db';
import { cn } from '../lib/utils';

interface MultiStepFormProps {
  onClose: () => void;
}

export function MultiStepForm({ onClose }: MultiStepFormProps) {
  const [step, setStep] = useState(1);
  const [type, setType] = useState<MovementType>('income');
  const [area, setArea] = useState<AreaType>('nico');
  
  // Form fields
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [client, setClient] = useState('');
  const [category, setCategory] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('contanti');
  const [collectedBy, setCollectedBy] = useState<CollectedBy>('nico');
  const [givenToPartner, setGivenToPartner] = useState('');

  const handleNext = () => setStep(step + 1);
  const handleBack = () => setStep(step - 1);

  const handleSubmit = async () => {
    await addMovement({
      type,
      area,
      date,
      amount: parseFloat(amount),
      description,
      client,
      category,
      paymentMethod,
      collectedBy: area === 'inlab' ? collectedBy : undefined,
      givenToPartner: givenToPartner ? parseFloat(givenToPartner) : undefined,
      notes: ''
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      <motion.div 
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        className="relative w-full max-w-md bg-[#F4F4F1] p-8 shadow-2xl overflow-hidden"
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-black/40 hover:text-black">
          <X size={20} />
        </button>

        <div className="mb-8">
          <span className="text-[10px] uppercase font-bold tracking-widest text-black/40">Inserimento rapido</span>
          <h2 className="text-2xl font-black uppercase tracking-tighter">Nuovo Movimento</h2>
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div 
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <p className="text-sm font-bold uppercase tracking-widest">Tipo e Area</p>
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => setType('income')}
                  className={cn(
                    "p-4 border border-black/10 flex flex-col gap-2 transition-all",
                    type === 'income' ? "bg-black text-white" : "bg-white hover:border-black"
                  )}
                >
                  <Plus size={20} />
                  <span className="text-xs font-bold uppercase tracking-widest">Incasso</span>
                </button>
                <button 
                  onClick={() => setType('expense')}
                  className={cn(
                    "p-4 border border-black/10 flex flex-col gap-2 transition-all",
                    type === 'expense' ? "bg-black text-white" : "bg-white hover:border-black"
                  )}
                >
                  <Minus size={20} />
                  <span className="text-xs font-bold uppercase tracking-widest">Spesa</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => setArea('nico')}
                  className={cn(
                    "p-4 border border-black/10 flex flex-col gap-2 transition-all",
                    area === 'nico' ? "bg-black text-white" : "bg-white hover:border-black"
                  )}
                >
                  <span className="text-xs font-bold uppercase tracking-widest">Nico</span>
                </button>
                <button 
                  onClick={() => setArea('inlab')}
                  className={cn(
                    "p-4 border border-black/10 flex flex-col gap-2 transition-all",
                    area === 'inlab' ? "bg-black text-white" : "bg-white hover:border-black"
                  )}
                >
                  <span className="text-xs font-bold uppercase tracking-widest">Inlab</span>
                </button>
              </div>

              <button 
                onClick={handleNext}
                className="w-full py-4 bg-black text-white font-bold uppercase tracking-widest flex items-center justify-center gap-2 group"
              >
                Continua <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </button>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div 
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase font-bold tracking-widest opacity-50 block mb-1">Importo (€)</label>
                  <input 
                    type="number" 
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full bg-white border border-black/10 p-3 outline-none focus:border-black font-bold text-lg"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold tracking-widest opacity-50 block mb-1">Data</label>
                  <input 
                    type="date" 
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full bg-white border border-black/10 p-3 outline-none focus:border-black"
                  />
                </div>
                {type === 'income' && (
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-widest opacity-50 block mb-1">Cliente</label>
                    <input 
                      type="text" 
                      value={client}
                      onChange={(e) => setClient(e.target.value)}
                      className="w-full bg-white border border-black/10 p-3 outline-none focus:border-black"
                      placeholder="Nome cliente"
                    />
                  </div>
                )}
                <div>
                  <label className="text-[10px] uppercase font-bold tracking-widest opacity-50 block mb-1">Descrizione</label>
                  <input 
                    type="text" 
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full bg-white border border-black/10 p-3 outline-none focus:border-black"
                    placeholder="Esempio: Spesa ufficio"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={handleBack} className="flex-1 py-4 border border-black font-bold uppercase tracking-widest text-xs">Indietro</button>
                <button onClick={handleNext} className="flex-[2] py-4 bg-black text-white font-bold uppercase tracking-widest text-xs">Continua</button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div 
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              {type === 'income' && (
                <>
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-widest opacity-50 block mb-1">Modalità</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => setPaymentMethod('contanti')}
                        className={cn("py-2 text-xs font-bold uppercase tracking-widest border transition-all", paymentMethod === 'contanti' ? "bg-black text-white border-black" : "bg-white border-black/10")}
                      >Contanti</button>
                      <button 
                        onClick={() => setPaymentMethod('fatt')}
                        className={cn("py-2 text-xs font-bold uppercase tracking-widest border transition-all", paymentMethod === 'fatt' ? "bg-black text-white border-black" : "bg-white border-black/10")}
                      >Fattura</button>
                    </div>
                  </div>

                  {area === 'inlab' && (
                    <>
                      <div>
                        <label className="text-[10px] uppercase font-bold tracking-widest opacity-50 block mb-1">Riscossore</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button 
                            onClick={() => setCollectedBy('nico')}
                            className={cn("py-2 text-xs font-bold uppercase tracking-widest border transition-all", collectedBy === 'nico' ? "bg-black text-white border-black" : "bg-white border-black/10")}
                          >Nico</button>
                          <button 
                            onClick={() => setCollectedBy('ilaria')}
                            className={cn("py-2 text-xs font-bold uppercase tracking-widest border transition-all", collectedBy === 'ilaria' ? "bg-black text-white border-black" : "bg-white border-black/10")}
                          >Ilaria</button>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] uppercase font-bold tracking-widest opacity-50 block mb-1">
                          Quanto {collectedBy === 'nico' ? 'hai dato a Ilaria' : 'ha dato Ilaria a Nico'}? (€)
                        </label>
                        <input 
                          type="number" 
                          value={givenToPartner}
                          onChange={(e) => setGivenToPartner(e.target.value)}
                          className="w-full bg-white border border-black/10 p-3 outline-none focus:border-black font-bold"
                          placeholder="0.00"
                        />
                      </div>
                    </>
                  )}
                </>
              )}

              {type === 'expense' && (
                <div>
                  <label className="text-[10px] uppercase font-bold tracking-widest opacity-50 block mb-1">Uso Conto (Facoltativo)</label>
                  <input 
                    type="text" 
                    className="w-full bg-white border border-black/10 p-3 outline-none focus:border-black"
                    placeholder="Conto corrente, Revolut, etc."
                  />
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={handleBack} className="flex-1 py-4 border border-black font-bold uppercase tracking-widest text-xs">Indietro</button>
                <button onClick={handleSubmit} className="flex-[2] py-4 bg-black text-white font-bold uppercase tracking-widest text-xs flex items-center justify-center gap-2">
                  <Check size={18} /> Salva Movimento
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
