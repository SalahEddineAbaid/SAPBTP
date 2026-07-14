import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Settings,
  ShoppingCart,
  Truck,
} from 'lucide-react';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: string[];
  adminMatch?: boolean;
};

const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['MANAGER'] },
  { to: '/orders', label: 'Commandes', icon: ShoppingCart },
  { to: '/suppliers', label: 'Fournisseurs', icon: Truck },
  { to: '/alerts', label: 'Alertes', icon: Bell, roles: ['MANAGER'] },
  { to: '/admin/users', label: 'Administration', icon: Settings, roles: ['ADMIN'], adminMatch: true },
];

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { user, logout, hasRole } = useAuth();
  const location = useLocation();

  const visibleItems = navItems.filter((item) => !item.roles || item.roles.some((role) => hasRole(role)));
  const displayName = user?.displayName || user?.username || 'admin';
  const initials = displayName.substring(0, 2).toUpperCase();

  const isItemActive = (item: NavItem, isActive: boolean) => (
    item.adminMatch ? location.pathname.startsWith('/admin') : isActive
  );

  return (
    <aside
      className={`${collapsed ? 'w-[84px]' : 'w-[292px]'} fixed inset-y-0 left-0 z-50 flex flex-col border-r border-slate-200 bg-white text-slate-950 shadow-[6px_0_28px_rgba(15,23,42,0.035)] transition-all duration-300 dark:border-[#1e2749] dark:bg-[#0b1027] dark:text-white`}
    >
      <div className={`${collapsed ? 'px-4' : 'px-5'} flex h-[88px] items-center border-b border-slate-200/80 dark:border-[#1e2749]`}>
        <div className={`flex w-full items-center ${collapsed ? 'justify-center' : 'justify-between gap-4'}`}>
          <div className={`flex min-w-0 items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2563eb] to-[#1554d1] shadow-lg shadow-blue-600/18 ring-1 ring-blue-500/20">
              <img
                src="/logo.png"
                alt="SmartOrder"
                className="h-6 w-auto object-contain brightness-0 invert drop-shadow-sm"
              />
            </div>

            {!collapsed && (
              <div className="min-w-0">
                <h1 className="truncate text-[15px] font-black tracking-tight text-slate-950 dark:text-white">
                  SmartOrder
                </h1>
                <p className="mt-0.5 truncate text-[12px] font-medium text-[#456b90] dark:text-slate-400">
                  SAP BTP
                </p>
              </div>
            )}
          </div>

          {!collapsed && (
            <button
              onClick={onToggle}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[#456b90] transition-all duration-200 hover:bg-slate-100 hover:text-[#1554d1] focus:outline-none focus:ring-2 focus:ring-blue-600/20 active:scale-95 dark:text-slate-400 dark:hover:bg-[#111a3a] dark:hover:text-cyan-300"
              aria-label="Réduire la sidebar"
            >
              <ChevronLeft size={18} strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>

      {collapsed && (
        <div className="border-b border-slate-200/80 px-4 py-3 dark:border-[#1e2749]">
          <button
            onClick={onToggle}
            className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl text-[#456b90] transition-all duration-200 hover:bg-slate-100 hover:text-[#1554d1] focus:outline-none focus:ring-2 focus:ring-blue-600/20 active:scale-95 dark:text-slate-400 dark:hover:bg-[#111a3a] dark:hover:text-cyan-300"
            aria-label="Agrandir la sidebar"
          >
            <ChevronRight size={18} strokeWidth={2.25} />
          </button>
        </div>
      )}

      <nav className={`${collapsed ? 'px-3' : 'px-5'} flex-1 overflow-y-auto py-6 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent dark:scrollbar-thumb-slate-800`}>
        {!collapsed && (
          <p className="mb-5 px-1 text-[11px] font-black uppercase tracking-[0.12em] text-[#456b90] dark:text-slate-500">
            Navigation
          </p>
        )}

        <div className="space-y-2">
          {visibleItems.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) => {
                  const active = isItemActive(item, isActive);
                  return [
                    'group relative flex h-12 items-center rounded-xl text-[15px] font-bold outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-blue-600/20',
                    collapsed ? 'justify-center px-0' : 'gap-3 px-3.5',
                    active
                      ? 'bg-[#2f64f5] text-white shadow-[0_12px_22px_rgba(47,100,245,0.20)]'
                      : 'text-slate-950 hover:bg-slate-50 hover:text-[#1554d1] dark:text-slate-200 dark:hover:bg-[#111a3a] dark:hover:text-cyan-300',
                  ].join(' ');
                }}
              >
                {({ isActive }) => {
                  const active = isItemActive(item, isActive);

                  return (
                    <>
                      <Icon
                        size={collapsed ? 21 : 20}
                        strokeWidth={active ? 2.5 : 2.25}
                        className={active ? 'text-white' : 'text-current'}
                      />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </>
                  );
                }}
              </NavLink>
            );
          })}
        </div>
      </nav>

      <div className={`${collapsed ? 'p-4' : 'p-5'} border-t border-slate-200 bg-white dark:border-[#1e2749] dark:bg-[#0b1027]`}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-4">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[#2f64f5] text-xs font-black text-white shadow-lg shadow-blue-600/20"
              title={`${displayName} (${user?.role || 'ADMIN'})`}
            >
              {initials}
            </div>
            <button
              className="flex h-9 w-9 items-center justify-center rounded-xl text-[#456b90] transition-all duration-200 hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-500/15 active:scale-95 dark:text-slate-400 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
              onClick={logout}
              title="Déconnexion"
              aria-label="Déconnexion"
            >
              <LogOut size={18} strokeWidth={2.25} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#2f64f5] text-xs font-black text-white shadow-lg shadow-blue-600/20">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-black text-slate-950 dark:text-white">{displayName}</p>
              <p className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-wide text-[#2f64f5] dark:text-cyan-300">
                {user?.role || 'ADMIN'}
              </p>
            </div>
            <button
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[#456b90] transition-all duration-200 hover:bg-slate-100 hover:text-[#1554d1] focus:outline-none focus:ring-2 focus:ring-blue-600/20 active:scale-95 dark:text-slate-400 dark:hover:bg-[#111a3a] dark:hover:text-cyan-300"
              onClick={onToggle}
              title="Réduire la sidebar"
              aria-label="Réduire la sidebar"
            >
              <ChevronLeft size={18} strokeWidth={2.25} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
