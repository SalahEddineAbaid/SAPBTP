import { useState, useEffect } from 'react';
import { Brain, RefreshCw, Play, CheckCircle, XCircle } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { fetchApi } from '../../services/apiClient';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend
} from 'recharts';

interface MLModel {
  ID: string;
  type: string;
  version: string;
  accuracy?: number;
  f1_score?: number;
  mae?: number;
  r2?: number;
  dataset_size?: number;
  trained_at?: string;
  actif: boolean;
}

interface MLServiceStatus {
  status: 'operational' | 'degraded' | 'down';
  version: string;
  last_prediction?: string;
}

export default function MLModelsPage() {
  const { getAuthHeaders } = useAuth();
  const [models, setModels] = useState<MLModel[]>([]);
  const [serviceStatus, setServiceStatus] = useState<MLServiceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [retraining, setRetraining] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Charger les modèles
      const modelsRes = await fetchApi('/api/admin/ml/models', {
        headers: getAuthHeaders(),
      }, { retries: 2, timeoutMs: 30000 });
      if (modelsRes.ok) {
        const modelsData = await modelsRes.json();
        setModels(modelsData.models || modelsData.value || []);
      }

      // Charger le statut du service ML
      const statusRes = await fetchApi('/api/admin/ml/status', {
        headers: getAuthHeaders(),
      }, { retries: 2, timeoutMs: 30000 });
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setServiceStatus(statusData);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const triggerRetraining = async () => {
    try {
      setRetraining(true);
      const res = await fetchApi('/api/admin/ml/retrain', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ force: true }),
      }, { retries: 2, timeoutMs: 60000 });
      
      if (!res.ok) throw new Error('Erreur réentraînement');
      
      alert('Réentraînement lancé avec succès');
      setTimeout(() => {
        loadData();
        setRetraining(false);
      }, 2000);
    } catch (err) {
      console.error(err);
      alert('Erreur lors du réentraînement du modèle');
      setRetraining(false);
    }
  };

  const formatDate = (date?: string) => {
    if (!date) return '—';
    return new Date(date).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatPercentage = (value?: number) => {
    if (value === undefined || value === null) return '—';
    return `${(value * 100).toFixed(2)}%`;
  };

  const getStatusColorClass = (status?: string) => {
    switch (status) {
      case 'operational': return 'text-emerald-500';
      case 'degraded': return 'text-amber-500';
      case 'down': return 'text-red-500';
      default: return 'text-slate-400 dark:text-slate-500';
    }
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'operational': return <CheckCircle size={18} />;
      case 'degraded': return <RefreshCw size={18} />;
      case 'down': return <XCircle size={18} />;
      default: return <RefreshCw size={18} />;
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'classification':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-600 border border-blue-500/20 dark:text-blue-450 dark:bg-blue-950/10">CLASSIFICATION</span>;
      case 'regression':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-600 border border-purple-500/20 dark:text-purple-400 dark:bg-purple-950/10">RÉGRESSION</span>;
      default:
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-650 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700/50">{type.toUpperCase()}</span>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px] w-full">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-blue-600 dark:border-slate-800 dark:border-t-cyan-400" />
      </div>
    );
  }

  // Préparer les données pour le graphique chronologique
  const chartData = [...models]
    .reverse()
    .map(m => ({
      version: m.version,
      accuracy: m.accuracy ? parseFloat((m.accuracy * 100).toFixed(2)) : 0,
      f1_score: m.f1_score ? parseFloat((m.f1_score * 100).toFixed(2)) : 0,
      mae: m.mae || 0,
    }));

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">Modèles ML</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Supervision et gestion des modèles de Machine Learning</p>
        </div>
      </div>

      {/* Statut du service ML */}
      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm backdrop-blur-md">
        <div className="border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-4">
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight">🤖 Statut du service ML</h3>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <div className={`${getStatusColorClass(serviceStatus?.status)} transition-colors duration-200`}>
                {getStatusIcon(serviceStatus?.status)}
              </div>
              <span className="font-bold text-base text-slate-800 dark:text-slate-100">
                {serviceStatus?.status === 'operational' 
                  ? 'Service opérationnel' 
                  : serviceStatus?.status === 'degraded' 
                    ? 'Service dégradé' 
                    : serviceStatus?.status === 'down' 
                      ? 'Service hors ligne' 
                      : 'Service opérationnel'}
              </span>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Version du service : <span className="font-semibold text-slate-700 dark:text-slate-300">{serviceStatus?.version || 'v1.0.0'}</span>
            </div>
            {serviceStatus?.last_prediction && (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Dernière prédiction : <span className="font-semibold text-slate-700 dark:text-slate-300">{formatDate(serviceStatus.last_prediction)}</span>
              </div>
            )}
          </div>

          <button
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-500 dark:to-blue-600 text-white shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
            onClick={triggerRetraining}
            disabled={retraining}
          >
            {retraining ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                Réentraînement...
              </>
            ) : (
              <>
                <Play size={16} />
                Réentraîner le modèle
              </>
            )}
          </button>
        </div>
      </div>

      {/* Informations de réentraînement */}
      <div className="flex items-start gap-3 p-4 rounded-xl border border-blue-500/20 bg-blue-500/5 dark:bg-cyan-500/5 dark:border-cyan-500/20 text-xs leading-relaxed">
        <Brain size={18} className="text-blue-500 dark:text-cyan-400 mt-0.5 flex-shrink-0" />
        <div>
          <strong className="font-bold text-slate-800 dark:text-slate-200">Forcer le réentraînement (ignorer le cache)</strong>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Réentraîne le modèle sur 50 commandes. Historique (1-100)/MAE(1-5) pour l'amélioration des performances.
          </p>
        </div>
      </div>

      {/* Tableau des modèles */}
      <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl shadow-sm overflow-hidden backdrop-blur-md">
        <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 p-5">
          <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight">📊 Modèles entraînés</h3>
        </div>

        {models.length > 0 ? (
          <div className="overflow-x-auto w-full">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Version</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Type</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749] text-center">Accuracy</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749] text-center">F1 Score</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749] text-center">MAE</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749] text-center">R²</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749] text-center">Dataset</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Entraîné le</th>
                  <th className="bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider py-4 px-6 border-b border-slate-200 dark:border-[#1e2749]">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                {models.map((model, index) => (
                  <tr 
                    key={model.ID || `${model.type || 'model'}-${model.version || 'version'}-${model.trained_at || index}`}
                    className="hover:bg-slate-50/30 dark:hover:bg-slate-950/10 transition-colors duration-150 animate-slide-up"
                    style={{ animationDelay: `${index * 0.02}s` }}
                  >
                    <td className="py-4 px-6 font-bold text-slate-800 dark:text-slate-100">{model.version}</td>
                    <td className="py-4 px-6">{getTypeBadge(model.type)}</td>
                    <td className="py-4 px-6 text-center font-bold">
                      <span className={model.accuracy != null && model.accuracy > 0.8 ? 'text-emerald-500' : 'text-amber-500'}>
                        {formatPercentage(model.accuracy)}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center font-bold">
                      <span className={model.f1_score != null && model.f1_score > 0.75 ? 'text-emerald-500' : 'text-amber-500'}>
                        {formatPercentage(model.f1_score)}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center text-slate-700 dark:text-slate-350 font-semibold tabular-nums">
                      {model.mae != null ? model.mae.toFixed(4) : '—'}
                    </td>
                    <td className="py-4 px-6 text-center text-slate-700 dark:text-slate-350 font-semibold tabular-nums">
                      {model.r2 != null ? formatPercentage(model.r2) : '—'}
                    </td>
                    <td className="py-4 px-6 text-center text-slate-550 dark:text-slate-400 text-xs font-bold">
                      {model.dataset_size ? `${model.dataset_size.toLocaleString()} lignes` : '—'}
                    </td>
                    <td className="py-4 px-6 text-xs text-slate-500 dark:text-slate-400 font-semibold tabular-nums whitespace-nowrap">
                      {formatDate(model.trained_at)}
                    </td>
                    <td className="py-4 px-6">
                      {model.actif ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 dark:text-emerald-400 dark:bg-emerald-950/10">Actif</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700/50">Inactif</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
            <Brain size={48} className="opacity-30 mb-4 animate-float" />
            <p className="text-sm font-semibold">Aucun modèle entraîné</p>
            <button 
              className="inline-flex items-center gap-2 px-3.5 py-1.5 h-8 mt-4 rounded-lg text-xs font-bold bg-gradient-to-r from-blue-600 to-sky-500 dark:from-cyan-500 dark:to-blue-600 text-white shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer" 
              onClick={triggerRetraining}
            >
              <Play size={14} />
              Entraîner le premier modèle
            </button>
          </div>
        )}
      </div>

      {/* Graphique d'évolution */}
      {models.length > 0 && (
        <div className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-2xl p-6 shadow-sm backdrop-blur-md">
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-6">
            <div>
              <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-200 tracking-tight">📈 Évolution des métriques</h3>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Précision (Accuracy) et F1 Score des modèles par version</p>
            </div>
          </div>
          <div className="h-72 min-h-[288px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={288}>
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.1)" />
                <XAxis 
                  dataKey="version" 
                  stroke="rgba(148, 163, 184, 0.5)" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false}
                />
                <YAxis 
                  domain={[0, 100]} 
                  stroke="rgba(148, 163, 184, 0.5)" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false} 
                  tickFormatter={(val) => `${val}%`}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: 'rgba(15, 22, 51, 0.95)',
                    border: '1px solid rgba(14, 165, 233, 0.2)',
                    borderRadius: '12px',
                    fontSize: '12px',
                    color: '#ffffff'
                  }}
                  itemStyle={{ color: '#ffffff' }}
                />
                <Legend verticalAlign="top" height={36} iconType="circle" iconSize={8} />
                <Line 
                  name="Accuracy"
                  type="monotone" 
                  dataKey="accuracy" 
                  stroke="#0ea5e9" 
                  strokeWidth={3} 
                  dot={{ r: 4, strokeWidth: 2, fill: '#0a0e27' }} 
                  activeDot={{ r: 6 }}
                />
                <Line 
                  name="F1 Score"
                  type="monotone" 
                  dataKey="f1_score" 
                  stroke="#a855f7" 
                  strokeWidth={3} 
                  dot={{ r: 4, strokeWidth: 2, fill: '#0a0e27' }} 
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

