import { useAuth } from '../../hooks/useAuth';
import { Search, Bell } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Header() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      navigate(`/orders?search=${encodeURIComponent(search.trim())}`);
      setSearch('');
    }
  };

  return (
    <header className="app-header">
      <form onSubmit={handleSearch} className="search-bar">
        <Search size={16} className="search-icon" />
        <input
          type="text"
          placeholder="Rechercher un numéro SAP..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button className="btn btn-ghost btn-sm" title="Notifications">
          <Bell size={18} />
        </button>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          {user?.email || user?.username}
        </span>
      </div>
    </header>
  );
}
