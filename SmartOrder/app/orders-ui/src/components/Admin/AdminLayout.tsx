import { Outlet, NavLink } from 'react-router-dom';
import { Users, FileText, RefreshCw, Brain } from 'lucide-react';

export default function AdminLayout() {
  const adminNavItems = [
    { path: '/admin/users', icon: Users, label: 'Utilisateurs' },
    { path: '/admin/logs', icon: FileText, label: 'Logs système' },
    { path: '/admin/sync', icon: RefreshCw, label: 'Sync SAP' },
    { path: '/admin/ml', icon: Brain, label: 'Modèles ML' },
  ];

  const navClass = (isActive: boolean) =>
    `flex items-center gap-3 px-3.5 py-2 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
      isActive 
        ? 'bg-blue-500/10 dark:bg-cyan-500/10 text-blue-600 dark:text-cyan-400 border border-blue-500/20 dark:border-cyan-500/20 shadow-sm' 
        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/50 hover:text-slate-900 dark:hover:text-white border border-transparent'
    }`;

  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-[calc(100vh-4rem)] animate-fade-in">
      {/* Sidebar Admin */}
      <aside className="w-full lg:w-60 bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-4 h-fit sticky top-20 backdrop-blur-md shadow-sm">
        <div className="mb-3">
          <h3 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-2">
            Administration
          </h3>
        </div>

        <nav className="flex flex-row lg:flex-col flex-wrap lg:flex-nowrap gap-1">
          {adminNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => navClass(isActive)}
            >
              <item.icon size={16} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Contenu Admin */}
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
