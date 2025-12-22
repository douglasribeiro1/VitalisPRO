        // ================================================================================== //
        // --- INÍCIO DO CONTEÚDO PARA O ARQUIVO: script.js (Recorte da linha abaixo) --- //
        // ================================================================================== //

        import { createApp, ref, computed, onMounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';
        import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
        import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
        import { getFirestore, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, enableIndexedDbPersistence, Timestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

        // ----------------------------------------------------------------------------------
        // ATENÇÃO: COLE ABAIXO OS DADOS DO FIREBASE QUE VOCÊ COPIOU DO CONSOLE
        // Substitua o objeto { ... } inteiro pelo seu config.
        // ----------------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyChz1_z4RbTgVVx1Q8tJC8E0CcibDP9WBY",
  authDomain: "vitalispro-b4378.firebaseapp.com",
  projectId: "vitalispro-b4378",
  storageBucket: "vitalispro-b4378.firebasestorage.app",
  messagingSenderId: "223435024126",
  appId: "1:223435024126:web:10ac911277a8d670c467af"
};
        // ----------------------------------------------------------------------------------

        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);

        // Tenta habilitar persistência offline (Critical for PWA)
        try {
            enableIndexedDbPersistence(db).catch((err) => console.log("Persistence error:", err.code));
        } catch(e) {}

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
                        .filter(r => r.category === 'Lembrete' && new Date(r.date) >= now) // Apenas datas futuras ou iguais
                        .sort((a, b) => new Date(a.date) - new Date(b.date)) // Ordenar do mais próximo
                        .slice(0, 5); // Pegar os 5 primeiros
                });

                // Auth Logic
                const loginWithGoogle = async () => {
                    loading.value = true;
                    errorMsg.value = '';
                    const provider = new GoogleAuthProvider();
                    try {
                        const result = await signInWithPopup(auth, provider);
                        if (result.user.email !== 'douglasrgomes@gmail.com') {
                            await signOut(auth);
                            errorMsg.value = 'Acesso restrito. Email não autorizado.';
                        }
                    } catch (error) {
                        console.error(error);
                        errorMsg.value = 'Erro ao fazer login.';
                    } finally {
                        loading.value = false;
                    }
                };

                const logout = () => signOut(auth);

                // Firestore Listeners
                let unsubscribeMembers = null;
                let unsubscribeRecords = null;

                const setupListeners = (uid) => {
                    const membersRef = collection(db, 'families', uid, 'members');
                    unsubscribeMembers = onSnapshot(membersRef, (snapshot) => {
                        members.value = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    });

                    const recordsRef = collection(db, 'families', uid, 'records');
                    const q = query(recordsRef, orderBy('date', 'desc'));
                    unsubscribeRecords = onSnapshot(q, (snapshot) => {
                        records.value = snapshot.docs.map(doc => {
                            const data = doc.data();
                            // Convert Timestamp to ISO string for easier handling in JS
                            const date = data.date && data.date.toDate ? data.date.toDate().toISOString() : data.date;
                            return { id: doc.id, ...data, date };
                        });
                    });
                };

                onMounted(() => {
                    onAuthStateChanged(auth, (currentUser) => {
                        if (currentUser && currentUser.email === 'douglasrgomes@gmail.com') {
                            user.value = currentUser;
                            setupListeners(currentUser.uid);
                        } else {
                            user.value = null;
                            if (currentUser) signOut(auth);
                        }
                    });
                });

                // Actions
                const addMember = async () => {
                    if (!newMember.value.name) return;
                    try {
                        await addDoc(collection(db, 'families', user.value.uid, 'members'), {
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

                        await addDoc(collection(db, 'families', user.value.uid, 'records'), {
                            ...newRecord.value,
                            memberName,
                            date: new Date(newRecord.value.date), // Save as timestamp
                            createdAt: serverTimestamp()
                        });
                        
                        // Prompt to add to calendar if it's a reminder
                        if (newRecord.value.category === 'Lembrete') {
                            if(confirm("Lembrete salvo! Deseja adicionar à sua Agenda Google?")) {
                                addToCalendar({...newRecord.value, memberName});
                            }
                        }

                        showAddRecordModal.value = false;
                        // Reset form partially
                        newRecord.value.title = '';
                        newRecord.value.details = '';
                    } catch (e) { alert('Erro: ' + e.message); }
                };

                const addToCalendar = (record) => {
                    const startDate = new Date(record.date);
                    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // +1 hora

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
                    // Set default date to now
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

        // ================================================================================== //
        // --- FIM DO CONTEÚDO PARA O ARQUIVO: script.js (Recorte até a linha acima) --- //
        // ================================================================================== //
