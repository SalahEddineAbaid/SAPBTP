import { motion } from 'framer-motion';
import * as Switch from '@radix-ui/react-switch';
import { Shield, Lock, ShieldAlert, Key, Globe, Eye, Monitor, ShieldCheck } from 'lucide-react';
import type { UserProfile } from '../../types';

interface SecurityCenterProps {
  profile: UserProfile;
  mfaEnabled: boolean;
  securityScore: number;
  onToggleMfa: () => void;
  onChangePasswordClick: () => void;
}

export default function SecurityCenter({
  profile,
  mfaEnabled,
  securityScore,
  onToggleMfa,
  onChangePasswordClick
}: SecurityCenterProps) {

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-[24px] p-6 shadow-xl backdrop-blur-md relative overflow-hidden"
    >
      <div className="border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-6 flex items-center justify-between">
        <h3 className="text-sm font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <Shield size={16} className="text-blue-500" />
          Centre de sécurité
        </h3>
        <span className="text-xs font-bold text-slate-400 dark:text-slate-500">YAAS Shield • Actif</span>
      </div>

      {/* Security Score Widget */}
      <div className="mb-6 p-4 bg-slate-55/40 dark:bg-slate-950/20 border border-slate-100 dark:border-slate-850/50 rounded-2xl">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <ShieldCheck size={18} className="text-emerald-500" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-350">Indice global de protection</span>
          </div>
          <span className="text-sm font-black text-slate-800 dark:text-white">{securityScore}/100</span>
        </div>
        {/* Animated Progress Bar */}
        <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${securityScore}%` }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
            className={`h-full rounded-full ${securityScore > 85 ? 'bg-emerald-500' : 'bg-amber-500'}`}
          />
        </div>
        <p className="text-[10px] font-semibold text-slate-400 mt-2">
          Votre compte est hautement protégé. Activez le double facteur pour atteindre 98%.
        </p>
      </div>

      {/* Security Settings list */}
      <div className="space-y-4">
        {/* Row 1: Password */}
        <div className="flex items-center justify-between py-2.5 border-b border-slate-50 dark:border-slate-800/30">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-50 dark:bg-[#11183c] rounded-xl text-blue-600 dark:text-cyan-400">
              <Key size={16} />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Mot de passe professionnel</p>
              <p className="text-[10px] text-slate-400">Modifié il y a 30 jours (Fort)</p>
            </div>
          </div>
          <button 
            onClick={onChangePasswordClick}
            className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-[10px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-950 transition-colors"
          >
            Changer
          </button>
        </div>

        {/* Row 2: MFA Switch */}
        <div className="flex items-center justify-between py-2.5 border-b border-slate-50 dark:border-slate-800/30">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-50 dark:bg-[#11183c] rounded-xl text-indigo-600 dark:text-cyan-400">
              <Lock size={16} />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Double facteur (MFA)</p>
              <p className="text-[10px] text-slate-400">Sécurise l'authentification des requêtes</p>
            </div>
          </div>
          {/* Radix UI Switch */}
          <Switch.Root 
            id="mfa-switch"
            checked={mfaEnabled}
            onCheckedChange={onToggleMfa}
            className="w-11 h-6 bg-slate-200 dark:bg-slate-800 rounded-full relative data-[state=checked]:bg-blue-600 dark:data-[state=checked]:bg-cyan-500 outline-none cursor-pointer transition-colors duration-200"
          >
            <Switch.Thumb className="block w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 translate-x-0.5 will-change-transform data-[state=checked]:translate-x-[22px]" />
          </Switch.Root>
        </div>

        {/* Row 3: Active Sessions */}
        <div className="flex items-center justify-between py-2.5 border-b border-slate-50 dark:border-slate-800/30">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-cyan-50 dark:bg-[#11183c] rounded-xl text-cyan-600 dark:text-cyan-400">
              <Monitor size={16} />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Sessions Actives</p>
              <p className="text-[10px] text-slate-400">2 appareils connectés</p>
            </div>
          </div>
          <span className="text-[10px] font-black text-slate-450 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2 py-0.5 rounded-md uppercase">
            Gérer
          </span>
        </div>

        {/* Row 4: Last connection location */}
        <div className="flex items-center justify-between py-2.5">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-purple-50 dark:bg-[#11183c] rounded-xl text-purple-600 dark:text-cyan-400">
              <Globe size={16} />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Dernier accès</p>
              <p className="text-[10px] text-slate-400">Casablanca, Maroc (Chrome/Win)</p>
            </div>
          </div>
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">
            {profile.derniere_connexion ? new Date(profile.derniere_connexion).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '10:14'}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
