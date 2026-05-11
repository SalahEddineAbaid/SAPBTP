import { NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  LayoutDashboard, ShoppingCart, Users, Settings,
  LogOut, Truck, Bell, Zap
} from 'lucide-react';

export default function Sidebar() {
  const { user, logout, hasRole } = useAuth();

  return (
    <aside className="app-sidebar">
      <div className="sidebar-logo">
        <Zap size={24} color="#3b82f6" />
        <h1>SmartOrder</h1>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section">Principal</div>

        <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <LayoutDashboard size={20} />
          <span>Dashboard</span>
        </NavLink>

        <NavLink to="/orders" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <ShoppingCart size={20} />
          <span>Commandes</span>
        </NavLink>

        <NavLink to="/suppliers" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Truck size={20} />
          <span>Fournisseurs</span>
        </NavLink>

        <NavLink to="/alerts" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Bell size={20} />
          <span>Alertes</span>
        </NavLink>

        {hasRole('ADMIN') && (
          <>
            <div className="nav-section">Administration</div>
            <NavLink to="/admin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Settings size={20} />
              <span>Admin</span>
            </NavLink>
            <NavLink to="/admin/users" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Users size={20} />
              <span>Utilisateurs</span>
            </NavLink>
          </>
        )}
      </nav>

      <div style={{ padding: '16px', borderTop: '1px solid var(--border-color)' }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
          {user?.username}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className={`badge ${user?.role === 'ADMIN' ? 'badge-danger' : user?.role === 'MANAGER' ? 'badge-warning' : 'badge-info'}`}>
            {user?.role}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={logout} title="Déconnexion">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
