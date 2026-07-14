import { motion } from 'framer-motion';
import { 
  Download, History, FileText, HelpCircle, 
  Settings2, ChevronRight, HardDrive, ArrowRight
} from 'lucide-react';
import type { UserProfile } from '../../types';

interface QuickActionsProps {
  profile: UserProfile;
  onExportClick: () => void;
}

export default function QuickActions({ profile, onExportClick }: QuickActionsProps) {
  const actions = [
    {
      title: 'Exporter le profil',
      desc: 'Télécharger les données au format JSON',
      icon: Download,
      action: onExportClick
    },
    {
      title: 'Historique de sécurité',
      desc: 'Accéder aux journaux de sécurité',
      icon: History,
      action: () => alert('Chargement des audits de sécurité...')
    },
    {
      title: 'Mes documents',
      desc: 'Consulter le coffre-fort de fichiers',
      icon: FileText,
      action: () => alert('Accès au coffre-fort de fichiers...')
    },
    {
      title: 'Accéder au support',
      desc: 'Ouvrir un ticket d\'assistance technique',
      icon: HelpCircle,
      action: () => window.open('https://support.sap.com', '_blank')
    }
  ];

  // If user is Admin, add Audit Logs action
  if (profile.role === 'ADMIN') {
    actions.push({
      title: "Logs d'audit système",
      desc: 'Consulter l\'historique global des transactions',
      icon: Settings2,
      action: () => window.location.href = '/admin'
    });
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.6 }}
      className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-[24px] p-6 shadow-xl backdrop-blur-md"
    >
      <div className="border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-5 flex items-center gap-2">
        <HardDrive size={16} className="text-blue-500" />
        <h3 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">Actions Rapides</h3>
      </div>

      <div className="grid grid-cols-1 gap-3.5">
        {actions.map((act) => {
          const IconComponent = act.icon;
          return (
            <motion.button
              key={act.title}
              onClick={act.action}
              whileHover={{ scale: 1.02, x: 4 }}
              className="w-full text-left p-3.5 bg-slate-50/50 dark:bg-slate-950/25 hover:bg-blue-50/50 dark:hover:bg-[#11183c]/50 border border-slate-200/50 dark:border-slate-800/50 hover:border-blue-200 dark:hover:border-cyan-500/35 rounded-2xl flex items-center justify-between transition-all duration-200 cursor-pointer group"
            >
              <div className="flex items-center space-x-3.5">
                <div className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 text-slate-500 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-cyan-400 rounded-xl transition-colors">
                  <IconComponent size={16} />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-350">{act.title}</p>
                  <p className="text-[10px] text-slate-450 dark:text-slate-500 leading-tight mt-0.5">{act.desc}</p>
                </div>
              </div>
              <ChevronRight size={14} className="text-slate-400 group-hover:text-blue-600 dark:group-hover:text-cyan-400 group-hover:translate-x-1 transition-all" />
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}
