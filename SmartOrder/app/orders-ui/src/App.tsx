import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './hooks/useAuth';
import Sidebar from './components/Layout/Sidebar';
import Header from './components/Layout/Header';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import OrdersListPage from './pages/OrdersListPage';
import OrderDetailPage from './pages/OrderDetailPage';
import SuppliersPage from './pages/SuppliersPage';
import AdminPage from './pages/AdminPage';

function ProtectedLayout() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app-main">
        <Header />
        <div className="app-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function AdminRoute() {
  const { hasRole } = useAuth();
  if (!hasRole('ADMIN')) return <Navigate to="/" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/orders" element={<OrdersListPage />} />
            <Route path="/orders/:id" element={<OrderDetailPage />} />
            <Route path="/suppliers" element={<SuppliersPage />} />
            <Route path="/alerts" element={<DashboardPage />} />

            <Route element={<AdminRoute />}>
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/admin/users" element={<AdminPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
