import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle,
  Edit,
  RefreshCw,
  Save,
  Search,
  Trash2,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import {
  createUser,
  deleteUser,
  getUsers,
  modifyUserRole,
  toggleUserStatus,
  updateUser,
  type UserPerimetre,
  type UpsertUserPayload,
} from '../../services/adminService';
import type { User } from '../../types';

type Role = 'USER' | 'MANAGER' | 'ADMIN';

interface UserFormState {
  ID?: string;
  username: string;
  email: string;
  prenom: string;
  nom: string;
  role: Role;
  actif: boolean;
  company_codes: string;
  purchasing_orgs: string;
}

const emptyForm: UserFormState = {
  username: '',
  email: '',
  prenom: '',
  nom: '',
  role: 'USER',
  actif: true,
  company_codes: '',
  purchasing_orgs: '',
};

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePerimetre(perimetre: unknown): UserPerimetre {
  if (!perimetre) return { company_codes: [], purchasing_orgs: [] };
  if (typeof perimetre === 'string') {
    try {
      return normalizePerimetre(JSON.parse(perimetre));
    } catch {
      return { company_codes: [], purchasing_orgs: [] };
    }
  }
  const value = perimetre as UserPerimetre;
  return {
    company_codes: Array.isArray(value.company_codes) ? value.company_codes : [],
    purchasing_orgs: Array.isArray(value.purchasing_orgs) ? value.purchasing_orgs : [],
  };
}

function toForm(user?: User): UserFormState {
  if (!user) return emptyForm;
  const perimetre = normalizePerimetre(user.perimetre);
  return {
    ID: user.ID,
    username: user.username || '',
    email: user.email || '',
    prenom: user.prenom || '',
    nom: user.nom || '',
    role: user.role,
    actif: user.actif,
    company_codes: perimetre.company_codes?.join(', ') || '',
    purchasing_orgs: perimetre.purchasing_orgs?.join(', ') || '',
  };
}

export default function UsersManagementPage() {
  const { getAuthHeaders } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<UserFormState>(emptyForm);

  const isEditing = Boolean(form.ID);

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getUsers(getAuthHeaders());
      setUsers(data.value || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur chargement utilisateurs');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setForm(emptyForm);
    setError(null);
    setSuccess(null);
    setFormOpen(true);
  };

  const openEdit = (user: User) => {
    setForm(toForm(user));
    setError(null);
    setSuccess(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setForm(emptyForm);
  };

  const saveUser = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const perimetre: UserPerimetre = {
      company_codes: splitList(form.company_codes),
      purchasing_orgs: splitList(form.purchasing_orgs),
    };

    try {
      const headers = getAuthHeaders();
      if (isEditing && form.ID) {
        await updateUser(
          form.ID,
          {
            email: form.email.trim(),
            prenom: form.prenom.trim(),
            nom: form.nom.trim(),
            actif: form.actif,
          },
          headers
        );
        await modifyUserRole(form.ID, form.role, perimetre, headers);
        setSuccess('Utilisateur modifie avec succes.');
      } else {
        const payload: UpsertUserPayload = {
          username: form.username.trim(),
          email: form.email.trim(),
          prenom: form.prenom.trim(),
          nom: form.nom.trim(),
          role: form.role,
          actif: form.actif,
          perimetre,
        };
        await createUser(payload, headers);
        setSuccess('Utilisateur cree avec succes.');
      }
      setFormOpen(false);
      setForm(emptyForm);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur enregistrement utilisateur');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleUserStatus = async (user: User) => {
    try {
      setError(null);
      setSuccess(null);
      await toggleUserStatus(user.ID, !user.actif, getAuthHeaders());
      setUsers((current) =>
        current.map((item) => (item.ID === user.ID ? { ...item, actif: !user.actif } : item))
      );
      setSuccess(user.actif ? 'Utilisateur desactive.' : 'Utilisateur active.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur mise a jour statut');
    }
  };

  const handleDeleteUser = async (user: User) => {
    const label = `${user.prenom || ''} ${user.nom || ''}`.trim() || user.username;
    const confirmed = window.confirm(`Supprimer l'utilisateur "${label}" ? Cette action est definitive.`);
    if (!confirmed) return;

    try {
      setError(null);
      setSuccess(null);
      await deleteUser(user.ID, getAuthHeaders());
      setUsers((current) => current.filter((item) => item.ID !== user.ID));
      setSuccess('Utilisateur supprime.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur suppression utilisateur');
    }
  };

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const fullName = `${user.prenom || ''} ${user.nom || ''}`.trim();
      const matchesSearch =
        search === '' ||
        user.username.toLowerCase().includes(search.toLowerCase()) ||
        user.email?.toLowerCase().includes(search.toLowerCase()) ||
        fullName.toLowerCase().includes(search.toLowerCase());

      const matchesRole = roleFilter === 'ALL' || user.role === roleFilter;
      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' && user.actif) ||
        (statusFilter === 'INACTIVE' && !user.actif);

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, search, roleFilter, statusFilter]);

  const formatDate = (date?: string) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'ADMIN':
        return 'bg-red-500/10 text-red-650 border border-red-500/20 dark:text-red-400 dark:bg-red-950/10';
      case 'MANAGER':
        return 'bg-amber-500/10 text-amber-600 border border-amber-500/20 dark:text-amber-400 dark:bg-amber-950/10';
      default:
        return 'bg-blue-500/10 text-blue-600 border border-blue-500/20 dark:text-blue-400 dark:bg-blue-950/10';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px] w-full">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-blue-600 dark:border-slate-800 dark:border-t-cyan-400" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">Gestion des utilisateurs</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{users.length} utilisateur{users.length > 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <button
            className="inline-flex items-center gap-2 px-3 py-1.5 h-8 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950/80 cursor-pointer transition-all duration-200"
            onClick={loadUsers}
          >
            <RefreshCw size={14} />
            Actualiser
          </button>
          <button
            className="inline-flex items-center gap-2 px-3.5 py-1.5 h-8 rounded-lg text-xs font-bold bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-500 dark:to-blue-600 text-white shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
            onClick={openCreate}
          >
            <UserPlus size={14} />
            Nouvel utilisateur
          </button>
        </div>
      </div>

      {(error || success) && (
        <div
          className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-semibold ${
            error
              ? 'border-red-500/20 bg-red-500/5 text-red-650 dark:text-red-400'
              : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-650 dark:text-emerald-400'
          }`}
        >
          <span>{error || success}</span>
          <button className="p-1" onClick={() => { setError(null); setSuccess(null); }} title="Fermer">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-4 shadow-sm backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-4 w-full">
          <div className="relative flex-1 min-w-[280px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              className="w-full h-10 pl-9 pr-4 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:bg-white dark:focus:bg-slate-950 focus:border-blue-600 dark:focus:border-cyan-400 focus:ring-2 focus:ring-blue-600/10 dark:focus:ring-cyan-400/10 transition-all placeholder-slate-400"
              placeholder="Rechercher par nom ou email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="h-10 px-3 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all cursor-pointer min-w-[160px]"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="ALL">Tous les roles</option>
            <option value="ADMIN">ADMIN</option>
            <option value="MANAGER">MANAGER</option>
            <option value="USER">USER</option>
          </select>

          <select
            className="h-10 px-3 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-blue-600 dark:focus:border-cyan-400 transition-all cursor-pointer min-w-[130px]"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">Tous les statuts</option>
            <option value="ACTIVE">Actifs</option>
            <option value="INACTIVE">Inactifs</option>
          </select>
        </div>
      </div>

      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl shadow-sm overflow-hidden backdrop-blur-md">
        <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 p-5">
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight">Liste des utilisateurs</h3>
        </div>

        {filteredUsers.length > 0 ? (
          <div className="overflow-x-auto w-full">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  {['Username', 'Nom complet', 'Email', 'Role', 'Perimetre', 'Derniere connexion', 'Actif', 'Actions'].map((label) => (
                    <th key={label} className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user, index) => {
                  const perimetre = normalizePerimetre(user.perimetre);
                  const hasPerimetre = Boolean(perimetre.company_codes?.length || perimetre.purchasing_orgs?.length);

                  return (
                    <tr
                      key={user.ID}
                      className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/30 dark:hover:bg-slate-950/10 transition-colors duration-150 animate-slide-up"
                      style={{ animationDelay: `${index * 0.02}s` }}
                    >
                      <td className="py-4 px-6 font-bold text-slate-850 dark:text-slate-100">{user.username}</td>
                      <td className="py-4 px-6 font-semibold text-slate-850 dark:text-slate-200">
                        {user.prenom || user.nom ? `${user.prenom || ''} ${user.nom || ''}`.trim() : '-'}
                      </td>
                      <td className="py-4 px-6 text-xs text-slate-500 dark:text-slate-400">{user.email}</td>
                      <td className="py-4 px-6 font-bold">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${getRoleBadgeClass(user.role)}`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        {hasPerimetre ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-850 dark:text-slate-300 dark:border-slate-700/50">Configure</span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-slate-550 dark:text-slate-400 text-xs font-semibold tabular-nums">
                        {formatDate(user.derniere_connexion)}
                      </td>
                      <td className="py-4 px-6">
                        <button
                          type="button"
                          onClick={() => handleToggleUserStatus(user)}
                          className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300"
                          title={user.actif ? 'Desactiver' : 'Activer'}
                        >
                          {user.actif ? (
                            <CheckCircle size={18} className="text-emerald-500" />
                          ) : (
                            <XCircle size={18} className="text-slate-400" />
                          )}
                          {user.actif ? 'Actif' : 'Inactif'}
                        </button>
                      </td>
                      <td className="py-4 px-6">
                        <div className="inline-flex items-center gap-1">
                          <button
                            className="inline-flex items-center justify-center p-2 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-cyan-400 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors cursor-pointer"
                            title="Editer"
                            onClick={() => openEdit(user)}
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            className="inline-flex items-center justify-center p-2 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors cursor-pointer"
                            title="Supprimer"
                            onClick={() => handleDeleteUser(user)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
            <Search size={48} className="opacity-30 mb-4 animate-float" />
            <p className="text-sm font-semibold">Aucun utilisateur trouve</p>
          </div>
        )}
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4 py-8">
          <form
            onSubmit={saveUser}
            className="w-full max-w-[620px] max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 p-5">
              <div>
                <h2 className="text-lg font-extrabold text-slate-800 dark:text-slate-100">
                  {isEditing ? 'Modifier utilisateur' : 'Nouvel utilisateur'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isEditing ? form.username : 'Compte applicatif SmartOrder'}
                </p>
              </div>
              <button type="button" className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-900" onClick={closeForm} title="Fermer">
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5">
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Username</span>
                <input
                  required
                  disabled={isEditing}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm disabled:opacity-60"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Email</span>
                <input
                  required
                  type="email"
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Prenom</span>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm"
                  value={form.prenom}
                  onChange={(e) => setForm({ ...form, prenom: e.target.value })}
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Nom</span>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm"
                  value={form.nom}
                  onChange={(e) => setForm({ ...form, nom: e.target.value })}
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Role</span>
                <select
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                >
                  <option value="USER">USER</option>
                  <option value="MANAGER">MANAGER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </label>

              <label className="flex items-end gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={form.actif}
                  onChange={(e) => setForm({ ...form, actif: e.target.checked })}
                  className="h-4 w-4"
                />
                <span className="text-sm font-bold text-slate-700 dark:text-slate-300">Compte actif</span>
              </label>

              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Company codes</span>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm"
                  placeholder="1000, 2000"
                  value={form.company_codes}
                  onChange={(e) => setForm({ ...form, company_codes: e.target.value })}
                />
              </label>

              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Purchasing orgs</span>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm"
                  placeholder="P100, P200"
                  value={form.purchasing_orgs}
                  onChange={(e) => setForm({ ...form, purchasing_orgs: e.target.value })}
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800 p-5">
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
                onClick={closeForm}
                disabled={saving}
              >
                Annuler
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 text-white disabled:opacity-60"
                disabled={saving}
              >
                <Save size={14} />
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
