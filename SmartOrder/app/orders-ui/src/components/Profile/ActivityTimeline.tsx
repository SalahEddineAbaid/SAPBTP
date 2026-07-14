import { motion } from 'framer-motion';
import { Activity, Key, UserCheck, ShieldAlert, Laptop } from 'lucide-react';

export default function ActivityTimeline() {
  const activities = [
    {
      title: 'Connexion réussie',
      desc: 'Depuis Casablanca (IP: 196.200.22.84)',
      time: "Aujourd'hui, 10:14",
      icon: Laptop,
      color: 'text-blue-500 bg-blue-500/10 border-blue-500/20'
    },
    {
      title: 'Modification du profil',
      desc: 'Numéro de téléphone mis à jour',
      time: 'Hier, 14:23',
      icon: UserCheck,
      color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
    },
    {
      title: 'Réinitialisation du mot de passe',
      desc: 'Clé de sécurité renouvelée',
      time: 'Il y a 5 jours, 09:12',
      icon: Key,
      color: 'text-purple-500 bg-purple-500/10 border-purple-500/20'
    },
    {
      title: 'Alerte de sécurité',
      desc: 'Nouvelle session Chrome détectée',
      time: 'Il y a 7 jours, 18:45',
      icon: ShieldAlert,
      color: 'text-amber-500 bg-amber-500/10 border-amber-500/20'
    }
  ];

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15
      }
    }
  };

  const item = {
    hidden: { opacity: 0, x: -15 },
    show: { opacity: 1, x: 0 }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4 }}
      className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-[24px] p-6 shadow-xl backdrop-blur-md"
    >
      <div className="border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-6 flex items-center gap-2">
        <Activity size={16} className="text-blue-500" />
        <h3 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">Timeline d'activité</h3>
      </div>

      <motion.div 
        variants={container}
        initial="hidden"
        animate="show"
        className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-100 dark:before:bg-slate-800/70"
      >
        {activities.map((act, index) => {
          const IconComponent = act.icon;
          return (
            <motion.div 
              key={index} 
              variants={item}
              className="relative flex items-start gap-4 text-xs font-semibold"
            >
              {/* Dot icon */}
              <div className={`absolute -left-[24px] top-1 p-1 rounded-full border ${act.color}`}>
                <IconComponent size={12} strokeWidth={2.5} />
              </div>
              
              <div className="space-y-0.5">
                <p className="font-bold text-slate-800 dark:text-slate-200">{act.title}</p>
                <p className="text-[10px] text-slate-400 font-semibold leading-relaxed">{act.desc}</p>
                <span className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 block pt-0.5">{act.time}</span>
              </div>
            </motion.div>
          );
        })}
      </motion.div>
    </motion.div>
  );
}
