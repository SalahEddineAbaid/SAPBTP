import { motion } from 'framer-motion';
import { 
  Edit3, Key, Download, Share2, Shield, CheckCircle, 
  Building2, Mail, Phone, ChevronDown, Award
} from 'lucide-react';
import type { UserProfile } from '../../types';

interface ProfileHeroProps {
  profile: UserProfile;
  editing: boolean;
  isProduction: boolean;
  onEditClick: () => void;
  onChangePasswordClick: () => void;
  onExportClick: () => void;
}

export default function ProfileHero({
  profile,
  editing,
  isProduction,
  onEditClick,
  onChangePasswordClick,
  onExportClick
}: ProfileHeroProps) {
  const getInitials = () => {
    if (profile.displayName) return profile.displayName.substring(0, 2).toUpperCase();
    if (profile.prenom && profile.nom) return `${profile.prenom[0]}${profile.nom[0]}`.toUpperCase();
    return profile.username.substring(0, 2).toUpperCase();
  };

  const getJobTitle = () => {
    if (profile.role === 'ADMIN') return 'Administrateur Principal & Architecte SaaS';
    if (profile.role === 'MANAGER') return 'Directeur des Approvisionnements & Achats';
    return 'Acheteur Technique Senior & Logistique';
  };

  const getEmployeeId = () => {
    return `YAAS-EMP-${profile.username.substring(0, 4).toUpperCase()}`;
  };

  const handlePrintPdf = () => {
    window.print();
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: `Profil de ${profile.displayName || profile.username}`,
        text: `Consulter le profil de ${profile.displayName || profile.username} sur YAAS Enterprise.`,
        url: window.location.href,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href);
      alert('Lien de partage copié dans le presse-papiers');
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="relative bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-[24px] overflow-hidden shadow-xl backdrop-blur-md"
    >
      {/* 220px Premium Banner with Mesh Gradient Effect */}
      <div className="h-[220px] bg-gradient-to-r from-blue-700 via-indigo-800 to-cyan-500 relative overflow-hidden">
        {/* Blurry gradient mesh blobs */}
        <div className="absolute top-[-50px] left-[-50px] w-72 h-72 rounded-full bg-cyan-400/25 blur-3xl animate-pulse" style={{ animationDuration: '6s' }} />
        <div className="absolute bottom-[-60px] right-[15%] w-80 h-80 rounded-full bg-blue-500/20 blur-3xl animate-pulse" style={{ animationDuration: '8s' }} />
        
        {/* Discret geometric lines pattern */}
        <div className="absolute inset-0 opacity-10" 
             style={{ 
               backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`, 
               backgroundSize: '24px 24px' 
             }} 
        />
        
        {/* YAAS Watermark text */}
        <div className="absolute top-8 right-12 text-[7rem] font-black text-white/5 select-none uppercase tracking-[0.2em] font-sans">
          YAAS
        </div>

        {/* Floating verified badge in the banner */}
        <div className="absolute top-6 left-8 flex items-center space-x-2 bg-white/10 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/10">
          <CheckCircle size={12} className="text-emerald-400" />
          <span className="text-[10px] font-black text-white tracking-wider uppercase">Certifié YAAS</span>
        </div>
      </div>

      {/* Profile Details Container */}
      <div className="px-8 pb-8 pt-0 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 relative">
        <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 -mt-16 sm:text-left text-center">
          {/* Avatar with dynamic status rings */}
          <div className="relative group shrink-0">
            <div className="w-28 h-28 rounded-full bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 text-white flex items-center justify-center text-4xl font-extrabold shadow-2xl border-4 border-white dark:border-[#0f1633] transition-transform duration-300 group-hover:scale-105">
              {getInitials()}
            </div>
            {/* Online Pulse Badge */}
            <div className="absolute bottom-1 right-1 w-7 h-7 bg-emerald-500 border-4 border-white dark:border-[#0f1633] rounded-full flex items-center justify-center shadow-lg" title="En ligne">
              <span className="w-2 h-2 bg-white rounded-full animate-ping" />
            </div>
          </div>

          {/* Profile Labels */}
          <div className="space-y-2 pt-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 justify-center sm:justify-start">
              <h2 className="text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight">
                {profile.displayName || `${profile.prenom || ''} ${profile.nom || ''}`.trim() || profile.username}
              </h2>
              <div className="flex gap-1.5 items-center justify-center">
                <span className="px-2.5 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  Actif
                </span>
                <span className="px-2.5 py-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  Vérifié
                </span>
              </div>
            </div>

            <p className="text-base font-bold text-slate-600 dark:text-slate-300 flex items-center gap-2 justify-center sm:justify-start">
              <Shield size={16} className="text-indigo-500" />
              {getJobTitle()}
            </p>

            <div className="flex flex-wrap justify-center sm:justify-start items-center gap-4 text-xs font-semibold text-slate-400 dark:text-slate-500 pt-1">
              <span className="flex items-center gap-1.5"><Building2 size={13} /> {profile.departement || 'IT'}</span>
              <span className="w-1.5 h-1.5 bg-slate-350 dark:bg-slate-700 rounded-full" />
              <span className="flex items-center gap-1.5"><Mail size={13} /> {profile.email}</span>
              <span className="w-1.5 h-1.5 bg-slate-350 dark:bg-slate-700 rounded-full" />
              <span>ID: {getEmployeeId()}</span>
            </div>
          </div>
        </div>

        {/* Action Deck */}
        <div className="flex flex-wrap justify-center sm:justify-end items-center gap-3">
          {!editing && (
            <button 
              onClick={onEditClick}
              className="px-5 py-3 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg hover:translate-y-[-2px] transition-all cursor-pointer flex items-center gap-2"
            >
              <Edit3 size={14} />
              Modifier le profil
            </button>
          )}
          <button 
            onClick={onChangePasswordClick}
            className="px-4.5 py-3 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950 hover:translate-y-[-2px] transition-all cursor-pointer flex items-center gap-2 shadow-sm"
          >
            <Key size={14} />
            Sécurité
          </button>
          <button 
            onClick={handlePrintPdf}
            className="px-4.5 py-3 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950 hover:translate-y-[-2px] transition-all cursor-pointer flex items-center gap-2 shadow-sm"
          >
            <Download size={14} />
            Télécharger PDF
          </button>
          <button 
            onClick={handleShare}
            className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950 hover:translate-y-[-2px] transition-all cursor-pointer shadow-sm"
            title="Partager le profil"
          >
            <Share2 size={14} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
