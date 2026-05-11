import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Zap, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Identifiants incorrects');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <Zap size={40} color="#3b82f6" />
        </div>
        <h1 className="login-title">SmartOrder</h1>
        <p className="login-subtitle">Gestion intelligente des commandes SAP</p>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-username">Nom d'utilisateur</label>
            <input id="login-username" className="form-input" type="text" placeholder="admin"
              value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="login-password">Mot de passe</label>
            <div style={{ position: 'relative' }}>
              <input id="login-password" className="form-input" type={showPw ? 'text' : 'password'}
                placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" onClick={() => setShowPw(!showPw)}
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-lg" disabled={loading}
            style={{ width: '100%', marginTop: '8px' }}>
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        <div style={{ marginTop: '24px', padding: '12px', background: 'var(--bg-input)',
          borderRadius: 'var(--radius-md)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>Comptes de test :</div>
          <div>admin / admin • manager / manager • user / user</div>
        </div>
      </div>
    </div>
  );
}
