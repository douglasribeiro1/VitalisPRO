import { createApp, ref, computed, onMounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, enableIndexedDbPersistence } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// =========================================================================
//  CONFIGURE AQUI SUAS CHAVES DO FIREBASE
//  Substitua o objeto abaixo inteiro pelos dados do seu Console Firebase
// =========================================================================
const firebaseConfig = {
  apiKey: "AIzaSyChz1_z4RbTgVVx1Q8tJC8E0CcibDP9WBY",
  authDomain: "vitalispro-b4378.firebaseapp.com",
  projectId: "vitalispro-b4378",
  storageBucket: "vitalispro-b4378.firebasestorage.app",
  messagingSenderId: "223435024126",
  appId: "1:223435024126:web:10ac911277a8d670c467af"
};

// Se não houver config, tenta pegar de variáveis globais (caso esteja em ambiente de teste)
const configToUse = Object.keys(firebaseConfig).length > 0 
    ? firebaseConfig 
    : (typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {});

// Inicialização
const app = initializeApp(configToUse);
const auth = getAuth(app);
const db = getFirestore(app);

// ID Compartilhado da Família (Hardcoded para unir os 3 emails)
const FAMILY_SHARED_ID = 'familia_principal_compartilhada';

// Lista de Emails Permitidos
const ALLOWED_EMAILS = [
    'douglasrgomes@gmail.com',
    'douglas20221690@gmail.com',
    'doribegomes@gmail.com'
];

// Persistência Offline
try {
    enableIndexedDbPersistence(db).catch((err) => {
        if (err.code == 'failed-precondition') {
            console.warn('Persistência falhou: Múltiplas abas abertas.');
        } else if (err.code == 'unimplemented') {
            console.warn('Persistência não suportada neste navegador.');
        }
    });
} catch(e) { console.log("Persistence setup error", e); }


createApp({
    setup() {
        const user = ref(null);
        const activeTab = ref('dashboard');
        const loading = ref(false);
        const errorMsg = ref('');
        
        // Modals
        const showAddMemberModal = ref(false);
        const showAddRecordModal = ref(false);

        // Data
        const members = ref([]);
        const records = ref([]);
        
        // Forms
        const newMember = ref({ name: '', birthDate: '', bloodType: '' });
        const newRecord = ref({ memberId: '', category: 'Lembrete', date: '', title: '', details: '' });

        // Computed
        const totalMembers = computed(() => members.value.length);
        const lastRecord = computed(() => records.value.length > 0 ? records.value[0] : null);
        
        const upcomingReminders = computed(() => {
            const now = new Date();
            return records.value
                .filter(r => r.category === 'Lembrete' && new Date(r.date) >= now)
                .sort((a, b) => new Date(a.date) - new Date(b.date))
                .slice(0, 5);
        });

        // Auth Logic
        const loginWithGoogle = async () => {
            loading.value = true;
            errorMsg.value = '';
            const provider = new GoogleAuthProvider();
            try {
                const result = await signInWithPopup(auth, provider);
                
                // Verifica se o email está na lista de permitidos
                if (!ALLOWED_EMAILS.includes(result.user.email)) {
                    await signOut(auth);
                    errorMsg.value = 'Acesso restrito. Email não está na lista autorizada.';
                }
            } catch (error) {
                console.error(error);
                errorMsg.value = 'Erro ao fazer login. Verifique o console.';
            } finally {
                loading.value = false;
            }
        };

        const logout = () => signOut(auth);

        // Firestore Listeners
        let unsubscribeMembers = null;
        let unsubscribeRecords = null;

        const setupListeners = () => {
            // Usa o ID Compartilhado
            const membersRef = collection(db, 'families', FAMILY_SHARED_ID, 'members');
            unsubscribeMembers = onSnapshot(membersRef, (snapshot) => {
                members.value = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            });

            const recordsRef = collection(db, 'families', FAMILY_SHARED_ID, 'records');
            const q = query(recordsRef, orderBy('date', 'desc'));
            unsubscribeRecords = onSnapshot(q, (snapshot) => {
                records.value = snapshot.docs.map(doc => {
                    const data = doc.data();
                    const date = data.date && data.date.toDate ? data.date.toDate().toISOString() : data.date;
                    return { id: doc.id, ...data, date };
                });
            });
        };

        onMounted(() => {
            onAuthStateChanged(auth, (currentUser) => {
                if (currentUser && ALLOWED_EMAILS.includes(currentUser.email)) {
                    user.value = currentUser;
                    setupListeners();
                } else {
                    user.value = null;
                    if (currentUser) signOut(auth); // Desloga se o usuário persistido não for autorizado
                }
            });
        });

        // Actions
        const addMember = async () => {
            if (!newMember.value.name) return;
            try {
                await addDoc(collection(db, 'families', FAMILY_SHARED_ID, 'members'), {
                    ...newMember.value,
                    createdAt: serverTimestamp()
                });
                showAddMemberModal.value = false;
                newMember.value = { name: '', birthDate: '', bloodType: '' };
            } catch (e) { alert('Erro: ' + e.message); }
        };

        const addRecord = async () => {
            if (!newRecord.value.title || !newRecord.value.date || !newRecord.value.memberId) {
                alert("Preencha os campos obrigatórios.");
                return;
            }
            try {
                const member = members.value.find(m => m.id === newRecord.value.memberId);
                const memberName = member ? member.name : 'Desconhecido';

                await addDoc(collection(db, 'families', FAMILY_SHARED_ID, 'records'), {
                    ...newRecord.value,
                    memberName,
                    date: new Date(newRecord.value.date),
                    createdAt: serverTimestamp()
                });
                
                if (newRecord.value.category === 'Lembrete') {
                    if(confirm("Lembrete salvo! Deseja adicionar à sua Agenda Google?")) {
                        addToCalendar({...newRecord.value, memberName});
                    }
                }

                showAddRecordModal.value = false;
                newRecord.value.title = '';
                newRecord.value.details = '';
            } catch (e) { alert('Erro: ' + e.message); }
        };

        const addToCalendar = (record) => {
            const startDate = new Date(record.date);
            const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); 

            const formatGoogleDate = (date) => {
                return date.toISOString().replace(/-|:|\.\d\d\d/g, "");
            };

            const title = encodeURIComponent(`Vitalis: ${record.title} (${record.memberName})`);
            const details = encodeURIComponent(record.details || '');
            const dates = `${formatGoogleDate(startDate)}/${formatGoogleDate(endDate)}`;

            const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}`;
            window.open(url, '_blank');
        };

        // UI Helpers
        const openMemberModal = () => showAddMemberModal.value = true;
        const openRecordModal = () => {
            const now = new Date();
            now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
            newRecord.value.date = now.toISOString().slice(0, 16);
            showAddRecordModal.value = true;
        };

        const calculateAge = (birthDate) => {
            if (!birthDate) return 0;
            const diff = Date.now() - new Date(birthDate).getTime();
            return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
        };

        const formatDate = (isoString) => {
            if (!isoString) return '';
            const date = new Date(isoString);
            return new Intl.DateTimeFormat('pt-BR', { 
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
            }).format(date);
        };

        const getCategoryColor = (cat) => {
            const map = { 'Consulta': 'bg-blue-500', 'Exame': 'bg-purple-500', 'Vacina': 'bg-green-500', 'Sintoma': 'bg-orange-500', 'Lembrete': 'bg-yellow-500' };
            return map[cat] || 'bg-slate-400';
        };

        const getCategoryIcon = (cat) => {
            const map = { 'Consulta': 'fa-solid fa-user-doctor', 'Exame': 'fa-solid fa-microscope', 'Lembrete': 'fa-regular fa-clock', 'Sintoma': 'fa-solid fa-heart-pulse' };
            return map[cat] || 'fa-solid fa-file';
        };

        return {
            user, loading, errorMsg, activeTab,
            members, records, totalMembers, lastRecord, upcomingReminders,
            showAddMemberModal, showAddRecordModal, newMember, newRecord,
            loginWithGoogle, logout, addMember, addRecord, addToCalendar,
            openMemberModal, openRecordModal,
            calculateAge, formatDate, getCategoryColor, getCategoryIcon
        };
    }
}).mount('#app');
