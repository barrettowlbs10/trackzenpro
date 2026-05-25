import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  FlatList, 
  ActivityIndicator, 
  StatusBar, 
  Vibration,
  Platform
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';

// Configure expo notifications behaviour
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Replace this with your computer's local IP (e.g. 192.168.1.5) when testing on a physical phone
const API_URL = 'http://localhost:3000/api';
const WS_URL = 'ws://localhost:3000';

export default function App() {
  const [screen, setScreen] = useState('login'); // 'login', 'dashboard', 'sales', 'detail'
  const [email, setEmail] = useState('demo@trackzenpro.com');
  const [password, setPassword] = useState('demo123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [token, setToken] = useState('');
  const [user, setUser] = useState(null);
  const [summary, setSummary] = useState({ revenue: 0, count: 0, ticket: 0, roas: 0 });
  const [sales, setSales] = useState([]);
  const [selectedSale, setSelectedSale] = useState(null);
  
  const ws = useRef(null);

  // Setup Notification listener
  useEffect(() => {
    registerForPushNotificationsAsync();

    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      // Handle click on push notification
      const data = response.notification.request.content.data;
      if (data && data.sale) {
        setSelectedSale(data.sale);
        setScreen('detail');
      }
    });

    return () => subscription.remove();
  }, []);

  // Connect to WebSocket once logged in
  useEffect(() => {
    if (token) {
      connectWebSocket();
    }
    return () => {
      if (ws.current) ws.current.close();
    };
  }, [token]);

  // Push notifications registration
  async function registerForPushNotificationsAsync() {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#7C3AED',
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('Permissão para notificações push negada!');
    }
  }

  // Synthesize register sound & vibrate on new sale
  async function playSaleSoundAndVibrate() {
    try {
      // Vibrate device
      if (Platform.OS !== 'web') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Vibration.vibrate(300);
      }
      
      // Play ding sound chimes
      const { sound } = await Audio.Sound.createAsync(
        { uri: 'https://assets.mixkit.co/active_storage/sfx/2019/2019-84.wav' } // Ding sound URL
      );
      await sound.playAsync();
    } catch (e) {
      console.log('Chime sound/vibration error:', e);
    }
  }

  // WebSocket handler for push simulation
  function connectWebSocket() {
    if (ws.current) return;
    
    ws.current = new WebSocket(`${WS_URL}?token=${token}`);
    
    ws.current.onmessage = async (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'new_sale') {
          // Play sale sound and trigger vibration
          playSaleSoundAndVibrate();
          
          // Present local push notification instantly
          await Notifications.scheduleNotificationAsync({
            content: {
              title: "🛒 Venda Aprovada!",
              body: `R$ ${data.sale.value.toFixed(2)} — ${data.sale.product} (${data.sale.platform})`,
              data: { sale: data.sale },
            },
            trigger: null, // show immediately
          });

          // Reload dashboard data
          fetchDashboardData();
        }
      } catch (err) {
        console.log('WS msg error:', err);
      }
    };

    ws.current.onclose = () => {
      ws.current = null;
      setTimeout(connectWebSocket, 5000); // Reconnect
    };
  }

  // API auth call
  async function handleLogin() {
    if (!email || !password) {
      setError('Preencha todos os campos');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Credenciais inválidas');
        setLoading(false);
        return;
      }
      setToken(data.token);
      setUser(data.user);
      
      // Load app stats
      fetchDashboardData(data.token);
      setScreen('dashboard');
    } catch (err) {
      setError('Servidor offline. Certifique-se de configurar o IP correto.');
    } finally {
      setLoading(false);
    }
  }

  // Load summary and sales
  async function fetchDashboardData(authToken = token) {
    try {
      const headers = { 'Authorization': `Bearer ${authToken}` };
      
      const summaryRes = await fetch(`${API_URL}/dashboard/summary?period=today`, { headers });
      const summaryData = await summaryRes.json();
      setSummary(summaryData);
      
      const salesRes = await fetch(`${API_URL}/sales?period=7d`, { headers });
      const salesData = await salesRes.json();
      setSales(salesData);
    } catch (e) {
      console.log('Error fetching stats:', e);
    }
  }

  function handleLogout() {
    setToken('');
    setUser(null);
    setScreen('login');
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }
  }

  // Format currency
  const fmt = (val) => `R$ ${parseFloat(val).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f1117" />
      
      {/* HEADER BAR (Logged In) */}
      {screen !== 'login' && (
        <View style={styles.header}>
          <Text style={styles.headerTitle}>TrackZen <Text style={styles.headerTag}>PRO</Text></Text>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Sair</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* LOGIN SCREEN */}
      {screen === 'login' && (
        <View style={styles.loginContainer}>
          <Text style={styles.logoTitle}>TrackZen <Text style={styles.headerTag}>PRO</Text></Text>
          <Text style={styles.logoSubtitle}>Acompanhe suas vendas de qualquer lugar</Text>
          
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          
          <TextInput 
            style={styles.input}
            placeholder="E-mail"
            placeholderTextColor="#4A5568"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput 
            style={styles.input}
            placeholder="Senha"
            placeholderTextColor="#4A5568"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          
          <TouchableOpacity style={styles.loginBtn} onPress={handleLogin} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginBtnText}>Entrar</Text>}
          </TouchableOpacity>
        </View>
      )}

      {/* DASHBOARD SCREEN */}
      {screen === 'dashboard' && (
        <View style={styles.mainContainer}>
          <Text style={styles.sectionTitle}>Dashboard Geral</Text>
          
          {/* KPI Grid */}
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>FATURAMENTO</Text>
              <Text style={[styles.kpiValue, { color: '#4ADE80' }]}>{fmt(summary.revenue || 0)}</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>VENDAS HOJE</Text>
              <Text style={styles.kpiValue}>{summary.count || 0}</Text>
            </View>
          </View>
          
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>TICKET MÉDIO</Text>
              <Text style={styles.kpiValue}>{fmt(summary.ticket || 0)}</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>ROAS</Text>
              <Text style={[styles.kpiValue, { color: '#F59E0B' }]}>{summary.roas ? summary.roas.toFixed(2) + 'x' : '0.00x'}</Text>
            </View>
          </View>

          {/* Navigation Tab bar */}
          <View style={styles.navTabs}>
            <TouchableOpacity style={[styles.tab, styles.activeTab]}>
              <Text style={styles.activeTabText}>Resumo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tab} onPress={() => setScreen('sales')}>
              <Text style={styles.tabText}>Vendas</Text>
            </TouchableOpacity>
          </View>

          {/* Recent sales */}
          <Text style={styles.subTitle}>Vendas Recentes (Hoje)</Text>
          <FlatList
            data={sales.slice(0, 5)}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.saleItem} onPress={() => { setSelectedSale(item); setScreen('detail'); }}>
                <View>
                  <Text style={styles.saleProduct}>{item.product}</Text>
                  <Text style={styles.saleMeta}>{item.platform} · {new Date(item.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</Text>
                </View>
                <Text style={styles.salePrice}>{fmt(item.value)}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.emptyText}>Nenhuma venda registrada hoje</Text>}
          />
        </View>
      )}

      {/* SALES HISTORY SCREEN */}
      {screen === 'sales' && (
        <View style={styles.mainContainer}>
          <View style={styles.navTabs}>
            <TouchableOpacity style={styles.tab} onPress={() => setScreen('dashboard')}>
              <Text style={styles.tabText}>Resumo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, styles.activeTab]}>
              <Text style={styles.activeTabText}>Vendas</Text>
            </TouchableOpacity>
          </View>
          
          <Text style={styles.sectionTitle}>Histórico de Vendas</Text>
          <FlatList
            data={sales}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.saleItem} onPress={() => { setSelectedSale(item); setScreen('detail'); }}>
                <View>
                  <Text style={styles.saleProduct}>{item.product}</Text>
                  <Text style={styles.saleMeta}>{item.platform} · {new Date(item.created_at).toLocaleString('pt-BR')}</Text>
                </View>
                <Text style={styles.salePrice}>{fmt(item.value)}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.emptyText}>Sem histórico de vendas nos últimos 7 dias</Text>}
          />
        </View>
      )}

      {/* DETAIL SCREEN */}
      {screen === 'detail' && selectedSale && (
        <View style={styles.mainContainer}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setScreen('dashboard')}>
            <Text style={styles.backBtnText}>← Voltar</Text>
          </TouchableOpacity>
          
          <Text style={styles.sectionTitle}>Detalhes da Venda</Text>
          
          <View style={styles.detailCard}>
            <View style={styles.detailGroup}>
              <Text style={styles.detailLabel}>PRODUTO</Text>
              <Text style={styles.detailValue}>{selectedSale.product || 'N/A'}</Text>
            </View>
            <View style={styles.detailGroup}>
              <Text style={styles.detailLabel}>VALOR</Text>
              <Text style={[styles.detailValue, { color: '#4ADE80', fontSize: 20 }]}>{fmt(selectedSale.value)}</Text>
            </View>
            <View style={styles.detailGroup}>
              <Text style={styles.detailLabel}>PLATAFORMA</Text>
              <Text style={styles.detailValue}>{selectedSale.platform.toUpperCase()}</Text>
            </View>
            <View style={styles.detailGroup}>
              <Text style={styles.detailLabel}>CAMPANHA</Text>
              <Text style={styles.detailValue}>{selectedSale.campaign || 'Sem Campanha'}</Text>
            </View>
            <View style={styles.detailGroup}>
              <Text style={styles.detailLabel}>HORÁRIO</Text>
              <Text style={styles.detailValue}>{new Date(selectedSale.created_at).toLocaleString('pt-BR')}</Text>
            </View>
            <View style={styles.detailGroup}>
              <Text style={styles.detailLabel}>ORIGEM (UTM)</Text>
              <Text style={styles.detailValue}>{selectedSale.utm_source || 'Tráfego Direto'}</Text>
            </View>
            <View style={styles.detailGroup}>
              <Text style={styles.detailLabel}>DISPOSITIVO</Text>
              <Text style={styles.detailValue}>{selectedSale.device || 'Desktop'}</Text>
            </View>
            <View style={styles.detailGroup}>
              <Text style={styles.detailLabel}>PAÍS / CIDADE</Text>
              <Text style={styles.detailValue}>{selectedSale.geo || 'Brasil / São Paulo'}</Text>
            </View>
            <View style={styles.detailGroup}>
              <Text style={styles.detailLabel}>STATUS PAGAMENTO</Text>
              <Text style={[styles.detailValue, { color: '#4ADE80' }]}>{selectedSale.status === 'approved' ? 'Aprovado' : selectedSale.status}</Text>
            </View>
          </View>
        </View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f1117',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    height: 60,
    backgroundColor: '#13151f',
    borderBottomWidth: 1,
    borderBottomColor: '#1e2130',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerTag: {
    color: '#7C3AED',
  },
  logoutButton: {
    padding: 6,
    borderRadius: 5,
    backgroundColor: '#1a1e2e',
    borderWidth: 1,
    borderBottomColor: '#2d3348',
  },
  logoutText: {
    color: '#8892a4',
    fontSize: 12,
  },
  loginContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 30,
    backgroundColor: '#0f1117',
  },
  logoTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  logoSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 32,
  },
  input: {
    height: 48,
    backgroundColor: '#1a1e2e',
    borderWidth: 1,
    borderColor: '#2d3348',
    borderRadius: 8,
    paddingHorizontal: 16,
    color: '#fff',
    fontSize: 14,
    marginBottom: 16,
  },
  loginBtn: {
    height: 48,
    backgroundColor: '#7C3AED',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  loginBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  errorText: {
    color: '#f87171',
    backgroundColor: '#3b1212',
    padding: 10,
    borderRadius: 6,
    marginBottom: 16,
    fontSize: 12,
    textAlign: 'center',
  },
  mainContainer: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginVertical: 12,
  },
  kpiRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: '#13151f',
    borderWidth: 1,
    borderColor: '#1e2130',
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 4,
  },
  kpiLabel: {
    fontSize: 9,
    color: '#6b7280',
    marginBottom: 4,
    fontWeight: '500',
  },
  kpiValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  navTabs: {
    flexDirection: 'row',
    backgroundColor: '#13151f',
    borderRadius: 6,
    padding: 4,
    marginVertical: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 4,
  },
  activeTab: {
    backgroundColor: '#7C3AED',
  },
  tabText: {
    color: '#6b7280',
    fontSize: 12,
  },
  activeTabText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  subTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#8892a4',
    marginBottom: 8,
  },
  saleItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#131823',
  },
  saleProduct: {
    fontSize: 13,
    color: '#e2e8f0',
    fontWeight: '500',
  },
  saleMeta: {
    fontSize: 10,
    color: '#6b7280',
    marginTop: 2,
  },
  salePrice: {
    fontSize: 13,
    color: '#22c55e',
    fontWeight: 'bold',
  },
  emptyText: {
    color: '#4a5568',
    textAlign: 'center',
    padding: 20,
    fontSize: 12,
  },
  backBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
    backgroundColor: '#1a1e2e',
    borderRadius: 6,
    marginBottom: 10,
  },
  backBtnText: {
    color: '#8892a4',
    fontSize: 12,
  },
  detailCard: {
    backgroundColor: '#13151f',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e2130',
    padding: 16,
  },
  detailGroup: {
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1e2e',
    paddingBottom: 8,
  },
  detailLabel: {
    fontSize: 9,
    color: '#6b7280',
    marginBottom: 2,
    fontWeight: 'bold',
  },
  detailValue: {
    fontSize: 13,
    color: '#fff',
  }
});
