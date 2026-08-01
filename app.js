// Import các hàm từ SDK Module của Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, set, onValue, runTransaction, get, push, query, limitToLast } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// Cấu hình Firebase của bạn
const firebaseConfig = {
    apiKey: "AIzaSyD8paYPgRUYh0CfHhlkDFwTpRoNq_BFZbg",
    authDomain: "messenger-f5c90.firebaseapp.com",
    databaseURL: "https://messenger-f5c90-default-rtdb.firebaseio.com",
    projectId: "messenger-f5c90",
    storageBucket: "messenger-f5c90.firebasestorage.app",
    messagingSenderId: "876963590642",
    appId: "1:876963590642:web:c87c47762f1c4facba3b6b"
};

// Khởi tạo Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Biến toàn cục
let currentUser = null;
let myBalance = 0;
let currentBet = null; 
let lastProcessedRollCount = 0;
let selectedType = null;
let selectedAmount = 0;

const formatMoney = (amount) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);

// ---------------------------------------------
// UI XÁC THỰC
// ---------------------------------------------
function showScreen(screenId) {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById(screenId).classList.remove('hidden');
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        showScreen('game-screen');
        document.getElementById('player-email').innerText = user.email;
        
        onValue(ref(db, 'users/' + user.uid), (snap) => {
            if(snap.exists()) {
                myBalance = snap.val().balance;
                document.getElementById('player-balance').innerText = formatMoney(myBalance);
            }
        });
        initGameSync();
        initChat();
    } else {
        currentUser = null;
        showScreen('auth-screen');
    }
});

// Gắn hàm vào window để HTML có thể gọi
window.register = async function() {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await set(ref(db, 'users/' + cred.user.uid), { email: email, balance: 5000000 });
    } catch(e) { document.getElementById('auth-error').innerText = e.message; }
};

window.login = async function() {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    try { await signInWithEmailAndPassword(auth, email, pass); }
    catch(e) { document.getElementById('auth-error').innerText = e.message; }
};

window.logout = function() { signOut(auth); };

// ---------------------------------------------
// LOGIC GAME & ĐỒNG BỘ
// ---------------------------------------------
function initGameSync() {
    onValue(ref(db, 'gameState'), (snap) => {
        if(!snap.exists()) return;
        const state = snap.val();
        
        if (state.rollCount > lastProcessedRollCount && lastProcessedRollCount !== 0) {
            processRollResult(state.currentScore, state.animalResult, state.isJackpot);
        }
        lastProcessedRollCount = state.rollCount;
        updateBoardVisuals(state);
    });

    setInterval(async () => {
        const snap = await get(ref(db, 'gameState'));
        let now = Date.now();
        let state = snap.val();
        
        if (!state) { triggerNewRoll(now); return; }

        let timeLeft = Math.ceil((state.nextRollTime - now) / 1000);
        if (timeLeft < 0) timeLeft = 0;
        document.getElementById('timer').innerText = timeLeft + "s";

        document.getElementById('btn-place-bet').disabled = (timeLeft <= 2);

        if (now >= state.nextRollTime) { triggerNewRoll(now); }
    }, 1000);
}

function triggerNewRoll(now) {
    runTransaction(ref(db, 'gameState'), (currentData) => {
        if (currentData === null) {
            return { nextRollTime: now + 12000, history: [], rollCount: 1, currentScore: 0, isJackpot: false };
        }
        if (now >= currentData.nextRollTime) {
            let newCount = (currentData.rollCount || 0) + 1;
            let history = currentData.history || [];
            let result = generateLogicalScore(history, newCount);
            
            history.push(result.animal);
            if (history.length > 50) history.shift();

            return {
                nextRollTime: currentData.nextRollTime + 12000,
                history: history,
                rollCount: newCount,
                currentScore: result.score,
                animalResult: result.animal,
                isJackpot: result.isJackpot
            };
        }
        return currentData; 
    });
}

function generateLogicalScore(historyArray, rollCount) {
    let attempts = 0;
    while (attempts < 100) {
        let isTenth = (rollCount % 10 === 0);
        let score = Math.floor(Math.random() * 91) + 10; 
        let isJackpot = false;

        if (isTenth) {
            score = (Math.random() > 0.5) ? 10 : 100;
            isJackpot = true;
        } else {
            if (score === 10 || score === 100) { attempts++; continue; }
        }

        let animal = score <= 40 ? 'Gà' : (score <= 59 ? 'Vịt' : 'Ngỗng');

        if (!isTenth && historyArray && historyArray.length > 0) {
            let recent7 = historyArray.slice(-6); 
            recent7.push(animal);
            let countIn7 = recent7.filter(a => a === animal).length;
            
            let consecutive = 1;
            for (let i = historyArray.length - 1; i >= 0; i--) {
                if (historyArray[i] === animal) consecutive++;
                else break;
            }

            if (countIn7 > 5 || consecutive > 5) { attempts++; continue; }
        }
        return { score, animal, isJackpot };
    }
    let score = Math.floor(Math.random() * 91) + 10;
    return { score, animal: score <= 40 ? 'Gà' : (score <= 59 ? 'Vịt' : 'Ngỗng'), isJackpot: false };
}

// ---------------------------------------------
// HỆ THỐNG CƯỢC
// ---------------------------------------------
window.selectType = function(type) {
    selectedType = type;
    document.querySelectorAll('.bet-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(type === 'Gà' ? 'btn-Ga' : type === 'Vịt' ? 'btn-Vit' : 'btn-Ngong').classList.add('active');
};

window.selectAmount = function(amt) {
    selectedAmount = amt;
    document.querySelectorAll('.amount-btn').forEach(b => b.classList.remove('active'));
    if(amt === 100000) document.getElementById('amt-100k').classList.add('active');
    else if(amt === 200000) document.getElementById('amt-200k').classList.add('active');
    else if(amt === 500000) document.getElementById('amt-500k').classList.add('active');
    else document.getElementById('amt-all').classList.add('active');
};

window.placeBet = function() {
    if (!selectedType || !selectedAmount) return alert("Vui lòng chọn Cửa và Mệnh giá cược!");
    let actualAmount = selectedAmount === 'ALL' ? myBalance : selectedAmount;
    
    if (actualAmount <= 0 || actualAmount > myBalance) return alert("Số dư không đủ!");
    if (currentBet) return alert("Bạn đã cược trong phiên này rồi!");

    runTransaction(ref(db, 'users/' + currentUser.uid + '/balance'), (bal) => {
        if(bal >= actualAmount) return bal - actualAmount;
        return bal;
    }).then((result) => {
        if(result.committed) {
            currentBet = { type: selectedType, amount: actualAmount };
            document.getElementById('bet-status').innerText = `Đã cược: ${formatMoney(actualAmount)} vào ${selectedType}`;
        }
    });
};

function processRollResult(score, animal, isJackpot) {
    if (!currentBet) return; 
    let won = (currentBet.type === animal);
    let betAmt = currentBet.amount;
    let logMsg = ""; let logClass = "";

    if (won) {
        let multiplier = isJackpot ? 21 : 3;
        let totalReturn = betAmt * multiplier;
        let netWin = totalReturn - betAmt; 
        
        runTransaction(ref(db, 'users/' + currentUser.uid + '/balance'), (bal) => (bal || 0) + totalReturn);
        logMsg = `THẮNG (+${formatMoney(netWin)}) [Cược ${currentBet.type}, Ra ${animal} - ${score}đ]`;
        logClass = "win";
    } else {
        logMsg = `THUA (-${formatMoney(betAmt)}) [Cược ${currentBet.type}, Ra ${animal} - ${score}đ]`;
        logClass = "lose";
    }

    let div = document.createElement('div');
    div.className = `history-item ${logClass}`;
    div.innerText = logMsg;
    document.getElementById('history-list').prepend(div);

    currentBet = null;
    document.getElementById('bet-status').innerText = "Chưa đặt cược";
}

function updateBoardVisuals(state) {
    if(!state || state.currentScore === 0) return;
    document.getElementById('jackpot-alert').style.display = state.isJackpot ? 'block' : 'none';

    let text = document.getElementById('current-result-text');
    text.innerText = `Lần trước: ${state.currentScore} ĐIỂM - Thuộc về: ${state.animalResult}`;
    text.style.color = state.animalResult === 'Gà' ? '#ff9800' : state.animalResult === 'Vịt' ? '#00d2ff' : '#4caf50';

    let remaining = state.currentScore - 10;
    let dice = Array(10).fill(1);
    while(remaining > 0) {
        let idx = Math.floor(Math.random()*10);
        if(dice[idx] < 10) { dice[idx]++; remaining--; }
    }

    let container = document.getElementById('dice-container');
    container.innerHTML = '';
    dice.forEach(val => {
        let d = document.createElement('div'); d.className = 'die'; d.innerText = val;
        container.appendChild(d);
    });
}

// ---------------------------------------------
// CHAT & CHUYỂN TIỀN
// ---------------------------------------------
function initChat() {
    const chatQuery = query(ref(db, 'chat'), limitToLast(50));
    onValue(chatQuery, (snap) => {
        const msgBox = document.getElementById('chat-messages');
        msgBox.innerHTML = '';
        snap.forEach((childSnap) => {
            let data = childSnap.val();
            let p = document.createElement('div');
            p.style.marginBottom = '5px';
            p.innerHTML = `<b style="color:#00d2ff;">${data.email.split('@')[0]}:</b> ${data.text}`;
            msgBox.appendChild(p);
        });
        msgBox.scrollTop = msgBox.scrollHeight;
    });
}

window.sendMessage = function() {
    let input = document.getElementById('chat-input-text');
    let text = input.value.trim();
    if(text.length > 0) {
        push(ref(db, 'chat'), { email: currentUser.email, text: text, time: Date.now() });
        input.value = '';
    }
};

window.transferMoney = async function() {
    let toEmail = document.getElementById('transfer-email').value.trim();
    let amount = parseInt(document.getElementById('transfer-amount').value);

    if(!toEmail || !amount || amount <= 0) return alert("Dữ liệu không hợp lệ!");
    if(amount > myBalance) return alert("Không đủ số dư!");
    if(toEmail === currentUser.email) return alert("Không thể chuyển cho chính mình!");

    const snap = await get(ref(db, 'users'));
    let users = snap.val();
    let targetUid = null;
    for(let uid in users) { if(users[uid].email === toEmail) { targetUid = uid; break; } }

    if(!targetUid) return alert("Không tìm thấy người dùng này!");

    runTransaction(ref(db, 'users/' + currentUser.uid + '/balance'), bal => bal - amount);
    runTransaction(ref(db, 'users/' + targetUid + '/balance'), bal => bal + amount);
    
    alert(`Đã chuyển thành công ${formatMoney(amount)} cho ${toEmail}!`);
    document.getElementById('transfer-amount').value = '';
};
