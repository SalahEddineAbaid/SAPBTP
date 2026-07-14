import { motion } from 'framer-motion';
import { Check, X, Award } from 'lucide-react';
import type { UserProfile } from '../../types';

interface ProfileScoreProps {
  profile: UserProfile;
  formData: {
    prenom: string;
    nom: string;
    telephone: string;
    departement: string;
    address: string;
    city: string;
  };
}

export default function ProfileScore({ profile, formData }: ProfileScoreProps) {
  // Compute completion score dynamically
  const checks = [
    { label: 'Informations personnelles', met: !!(formData.prenom && formData.nom) },
    { label: 'Téléphone configuré', met: !!formData.telephone },
    { label: 'Département assigné', met: !!formData.departement },
    { label: 'Email vérifié', met: !!profile.email },
    { label: 'Adresse physique', met: !!(formData.address && formData.address !== 'Non renseigné') },
    { label: 'Photo de profil HD', met: !!profile.avatar_url }
  ];

  const metCount = checks.filter(c => c.met).length;
  const scorePercent = Math.round((metCount / checks.length) * 100);

  // SVG parameters for circle
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (scorePercent / 100) * circumference;

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-[24px] p-6 shadow-xl backdrop-blur-md flex flex-col items-center text-center justify-between"
    >
      <div className="w-full border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-5 text-left flex items-center gap-2">
        <Award size={16} className="text-blue-500" />
        <h3 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">Complétude du Profil</h3>
      </div>

      {/* Circular Progress Ring */}
      <div className="relative w-36 h-36 flex items-center justify-center mb-6">
        <svg className="w-full h-full transform -rotate-90">
          {/* Base track */}
          <circle 
            cx="72" 
            cy="72" 
            r={radius} 
            className="stroke-slate-100 dark:stroke-slate-800" 
            strokeWidth="10" 
            fill="transparent" 
          />
          {/* Active progress */}
          <motion.circle 
            cx="72" 
            cy="72" 
            r={radius} 
            className="stroke-blue-600 dark:stroke-cyan-400" 
            strokeWidth="10" 
            fill="transparent" 
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1, ease: 'easeInOut' }}
            strokeLinecap="round"
          />
        </svg>
        {/* Core text with React CountUp style animation */}
        <div className="absolute flex flex-col items-center">
          <span className="text-3xl font-black text-slate-800 dark:text-white">{scorePercent}%</span>
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Complété</span>
        </div>
      </div>

      {/* Checklist items */}
      <div className="w-full space-y-2.5 text-left">
        {checks.map((check, index) => (
          <div key={index} className="flex items-center justify-between text-xs font-semibold">
            <span className={check.met ? 'text-slate-700 dark:text-slate-350' : 'text-slate-400 dark:text-slate-650'}>
              {check.label}
            </span>
            <div className={`p-1 rounded-full ${check.met ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'}`}>
              {check.met ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
