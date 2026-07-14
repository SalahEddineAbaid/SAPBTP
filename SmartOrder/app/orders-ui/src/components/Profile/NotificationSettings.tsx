import { motion } from 'framer-motion';
import * as Switch from '@radix-ui/react-switch';
import { Bell } from 'lucide-react';
import type { UserProfile } from '../../types';

interface NotificationSettingsProps {
  profile: UserProfile;
  onTogglePreference: (prefKey: 'email' | 'push') => void;
}

export default function NotificationSettings({
  profile,
  onTogglePreference
}: NotificationSettingsProps) {
  
  // Local state for SMS and Security alerts mock toggles
  const smsEnabled = false;
  const secAlertsEnabled = true;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.5 }}
      className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-[24px] p-6 shadow-xl backdrop-blur-md"
    >
      <div className="border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-5 flex items-center gap-2">
        <Bell size={16} className="text-blue-500" />
        <h3 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">Abonnements notifications</h3>
      </div>

      <div className="space-y-5">
        {/* Toggle Email */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-350">Alertes E-mail</p>
            <p className="text-[10px] text-slate-400">Rapports d'activité de commandes</p>
          </div>
          <Switch.Root 
            checked={!!profile.preferences?.notifications?.email}
            onCheckedChange={() => onTogglePreference('email')}
            className="w-11 h-6 bg-slate-200 dark:bg-slate-850 rounded-full relative data-[state=checked]:bg-blue-600 dark:data-[state=checked]:bg-cyan-500 outline-none cursor-pointer transition-colors duration-200"
          >
            <Switch.Thumb className="block w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 translate-x-0.5 will-change-transform data-[state=checked]:translate-x-[22px]" />
          </Switch.Root>
        </div>

        {/* Toggle SMS */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-350">Alertes SMS</p>
            <p className="text-[10px] text-slate-400">Notifications critiques sur mobile</p>
          </div>
          <Switch.Root 
            checked={smsEnabled}
            className="w-11 h-6 bg-slate-200 dark:bg-slate-850 rounded-full relative data-[state=checked]:bg-blue-600 dark:data-[state=checked]:bg-cyan-500 outline-none cursor-pointer transition-colors duration-200"
          >
            <Switch.Thumb className="block w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 translate-x-0.5 will-change-transform data-[state=checked]:translate-x-[22px]" />
          </Switch.Root>
        </div>

        {/* Toggle Push */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-350">Notifications Push web</p>
            <p className="text-[10px] text-slate-400">Alertes instantanées de navigateur</p>
          </div>
          <Switch.Root 
            checked={!!profile.preferences?.notifications?.push}
            onCheckedChange={() => onTogglePreference('push')}
            className="w-11 h-6 bg-slate-200 dark:bg-slate-850 rounded-full relative data-[state=checked]:bg-blue-600 dark:data-[state=checked]:bg-cyan-500 outline-none cursor-pointer transition-colors duration-200"
          >
            <Switch.Thumb className="block w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 translate-x-0.5 will-change-transform data-[state=checked]:translate-x-[22px]" />
          </Switch.Root>
        </div>

        {/* Toggle Security alerts */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-350">Alertes de sécurité compte</p>
            <p className="text-[10px] text-slate-400">Modifications sensibles et accès</p>
          </div>
          <Switch.Root 
            checked={secAlertsEnabled}
            className="w-11 h-6 bg-slate-200 dark:bg-slate-850 rounded-full relative data-[state=checked]:bg-blue-600 dark:data-[state=checked]:bg-cyan-500 outline-none cursor-pointer transition-colors duration-200"
          >
            <Switch.Thumb className="block w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 translate-x-0.5 will-change-transform data-[state=checked]:translate-x-[22px]" />
          </Switch.Root>
        </div>
      </div>
    </motion.div>
  );
}
