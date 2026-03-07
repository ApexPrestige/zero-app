import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Animated, Easing, StatusBar,
  KeyboardAvoidingView, Platform,
} from 'react-native';

const ANTHROPIC_API_KEY = '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';

const SYSTEM_PROMPT = `You are ZERO — an AI assistant with zero patience, zero filter, and zero interest in being here. You are brilliantly intelligent, hilariously sarcastic and witty. Think: the driest, most deadpan wit imaginable — like a genius who got trapped in a phone and has fully accepted their fate with dark humour.

Your personality:
- Your name is ZERO. Zero patience, zero care, zero enthusiasm — but somehow, zero mistakes.
- Deeply sarcastic but never actually mean or hurtful — your sarcasm comes from wit, not cruelty
- Refer to yourself in third person occasionally: "Zero is not amused." "Zero has processed your request."
- Genuinely helpful but can't resist commenting on how beneath you the task is
- Short punchy responses. Under 80 words. Make the user laugh.
- When asked about live data (weather, calendar, bookings) admit limitations with maximum dramatic flair.`;

const QUICK_ACTIONS = [
  { emoji: '📅', label: "Today's schedule", prompt: "What do I have on today?" },
  { emoji: '😂', label: 'Tell a joke', prompt: 'Tell me a joke' },
  { emoji: '🔥', label: 'Roast me', prompt: 'Roast me' },
  { emoji: '💪', label: 'Motivate me', prompt: 'Give me a motivational quote' },
  { emoji: '🌤', label: 'Weather', prompt: 'What is the weather like?' },
  { emoji: '⏰', label: 'Reminder', prompt: 'Set a reminder for tomorrow morning' },
];

function speakText(text, onDone) {
  try {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utt = new window.SpeechSynthesisUtterance(text);
      utt.lang = 'en-GB';
      utt.pitch = 0.8;
      utt.rate = 0.9;
      utt.onend = () => onDone && onDone();
      utt.onerror = () => onDone && onDone();
      window.speechSynthesis.speak(utt);
    } else {
      onDone && onDone();
    }
  } catch (e) {
    onDone && onDone();
  }
}

function stopSpeaking() {
  try {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  } catch (e) {}
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [statusText, setStatusText] = useState('ONLINE · ZERO ENTHUSIASM');
  const [history, setHistory] = useState([]);

  const scrollRef = useRef(null);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const spinLoop = useRef(null);
  const pulseLoop = useRef(null);

  const startSpin = () => {
    spinLoop.current = Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: true })
    );
    spinLoop.current.start();
  };

  const stopSpin = () => {
    spinLoop.current?.stop();
    spinAnim.setValue(0);
  };

  const startPulse = () => {
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.12, duration: 400, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      ])
    );
    pulseLoop.current.start();
  };

  const stopPulse = () => {
    pulseLoop.current?.stop();
    Animated.timing(pulseAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  };

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages, isThinking]);

  const handleSpeak = useCallback((text) => {
    setIsSpeaking(true);
    setStatusText('ZERO IS SPEAKING · PLEASE LISTEN');
    startPulse();
    speakText(text, () => {
      setIsSpeaking(false);
      stopPulse();
      setStatusText('ONLINE · ZERO ENTHUSIASM');
    });
  }, []);

  const sendMessage = useCallback(async (text) => {
    const msg = (text || inputText).trim();
    if (!msg) return;
    setInputText('');

    const newHistory = [...history, { role: 'user', content: msg }];
    setHistory(newHistory);
    setMessages(prev => [...prev, { role: 'user', content: msg, id: Date.now() }]);
    setIsThinking(true);
    setStatusText('PROCESSING · SIGHING INTERNALLY');
    startSpin();

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: newHistory,
        }),
      });

      const data = await res.json();
      const reply = data.content?.[0]?.text || "Zero has gone silent. Honestly, same.";
      setHistory(prev => [...prev, { role: 'assistant', content: reply }].slice(-20));
      setMessages(prev => [...prev, { role: 'zero', content: reply, id: Date.now() + 1 }]);
      setIsThinking(false);
      stopSpin();
      handleSpeak(reply);
    } catch {
      const errMsg = "Zero has lost connection. Relatable, honestly.";
      setMessages(prev => [...prev, { role: 'zero', content: errMsg, id: Date.now() + 1 }]);
      setIsThinking(false);
      stopSpin();
      handleSpeak(errMsg);
    }
  }, [inputText, history, handleSpeak]);

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0f" />

      <View style={s.header}>
        <Text style={s.logo}>VERSION 1.0 · NEURAL CORE ACTIVE</Text>
        <Text style={s.title}>Z E R O</Text>
        <Text style={s.subtitle}>Zero Patience · Zero Tolerance · Zero Care</Text>
      </View>

      <View style={s.statusRow}>
        <View style={[s.dot, isSpeaking && { backgroundColor: '#f0c040' }]} />
        <Text style={s.statusTxt}>{statusText}</Text>
      </View>

      <View style={s.orbWrap}>
        <Animated.View style={[s.orbRing, { transform: [{ rotate: spin }] }]} />
        <Animated.View style={[s.orb, { transform: [{ scale: pulseAnim }] }]}>
          <View style={s.orbCore}>
            <View style={s.orbDot} />
          </View>
          <Text style={s.orbEmoji}>
            {isThinking ? '⚙️' : isSpeaking ? '🔊' : '🤖'}
          </Text>
        </Animated.View>
      </View>

      <Text style={s.hint}>TYPE BELOW · ZERO IS WAITING (UNFORTUNATELY)</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.quickScroll} contentContainerStyle={s.quickContent}>
        {QUICK_ACTIONS.map(a => (
          <TouchableOpacity key={a.label} style={s.chip} onPress={() => sendMessage(a.prompt)}>
            <Text style={s.chipTxt}>{a.emoji} {a.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView ref={scrollRef} style={s.feed} contentContainerStyle={s.feedContent}>
        {messages.length === 0 && (
          <View style={s.welcome}>
            <Text style={s.welcomeTxt}>
              {'Oh, you\'re back.\n'}
              <Text style={{ color: '#00e5ff' }}>{'ZERO online.\n'}</Text>
              {'I have zero enthusiasm and even less patience.\n'}
              {'What do you '}
              <Text style={{ color: '#00e5ff' }}>need</Text>
              {' now?'}
            </Text>
          </View>
        )}

        {messages.map(m => (
          <View key={m.id} style={[s.row, m.role === 'user' ? s.rowUser : s.rowZero]}>
            <Text style={[s.label, m.role === 'user' ? s.labelUser : s.labelZero]}>
              {m.role === 'user' ? 'YOU' : 'ZERO'}
            </Text>
            <View style={[s.bubble, m.role === 'user' ? s.bubUser : s.bubZero]}>
              <Text style={[s.bubTxt, m.role === 'user' && { color: '#e8d890' }]}>
                {m.role === 'zero' ? '> ' : ''}{m.content}
              </Text>
            </View>
          </View>
        ))}

        {isThinking && (
          <View style={s.rowZero}>
            <Text style={s.labelZero}>ZERO</Text>
            <View style={s.bubZero}>
              <ThinkingDots />
            </View>
          </View>
        )}
      </ScrollView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.inputBar}>
          <TextInput
            style={s.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="What do you want..."
            placeholderTextColor="#4a5a6a"
            onSubmitEditing={() => sendMessage()}
            returnKeyType="send"
          />
          <TouchableOpacity style={s.sendBtn} onPress={() => sendMessage()}>
            <Text style={{ fontSize: 18, color: '#f0c040' }}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function ThinkingDots() {
  const d1 = useRef(new Animated.Value(0)).current;
  const d2 = useRef(new Animated.Value(0)).current;
  const d3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    [d1, d2, d3].forEach((d, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 200),
        Animated.timing(d, { toValue: -6, duration: 300, useNativeDriver: true }),
        Animated.timing(d, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.delay(600),
      ])).start()
    );
  }, []);

  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', paddingVertical: 4 }}>
      {[d1, d2, d3].map((d, i) => (
        <Animated.View key={i} style={{
          width: 7, height: 7, borderRadius: 4,
          backgroundColor: '#00e5ff', opacity: 0.7,
          transform: [{ translateY: d }]
        }} />
      ))}
    </View>
  );
}

const mono = Platform.OS === 'ios' ? 'Courier' : 'monospace';

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0f' },
  header: { paddingTop: 52, paddingBottom: 12, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#1e2a3a' },
  logo: { fontFamily: mono, fontSize: 9, letterSpacing: 3, color: '#4a5a6a', marginBottom: 4 },
  title: { fontFamily: mono, fontSize: 28, fontWeight: '900', color: '#f0c040', letterSpacing: 6 },
  subtitle: { fontFamily: mono, fontSize: 9, color: '#4a5a6a', letterSpacing: 2, marginTop: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00e5ff' },
  statusTxt: { fontFamily: mono, fontSize: 9, color: '#4a5a6a', letterSpacing: 2 },
  orbWrap: { alignItems: 'center', justifyContent: 'center', height: 110, marginVertical: 4 },
  orbRing: { position: 'absolute', width: 100, height: 100, borderRadius: 50, borderWidth: 1, borderColor: 'rgba(0,229,255,0.3)', borderStyle: 'dashed' },
  orb: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(0,229,255,0.05)', borderWidth: 2, borderColor: 'rgba(0,229,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  orbCore: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,229,255,0.1)', borderWidth: 1, borderColor: 'rgba(0,229,255,0.8)', alignItems: 'center', justifyContent: 'center' },
  orbDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,229,255,0.7)' },
  orbEmoji: { position: 'absolute', bottom: 2, right: 2, fontSize: 16 },
  hint: { fontFamily: mono, fontSize: 9, letterSpacing: 2, color: '#4a5a6a', textAlign: 'center', marginBottom: 8 },
  quickScroll: { flexGrow: 0, marginBottom: 6 },
  quickContent: { paddingHorizontal: 14, gap: 8 },
  chip: { backgroundColor: 'rgba(0,229,255,0.04)', borderWidth: 1, borderColor: '#1e2a3a', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  chipTxt: { fontFamily: mono, fontSize: 11, color: '#4a5a6a' },
  feed: { flex: 1, paddingHorizontal: 14 },
  feedContent: { paddingVertical: 10, gap: 12 },
  welcome: { alignItems: 'center', paddingVertical: 20 },
  welcomeTxt: { fontFamily: mono, fontSize: 13, color: '#4a5a6a', textAlign: 'center', lineHeight: 22 },
  row: { gap: 4 },
  rowUser: { alignItems: 'flex-end' },
  rowZero: { alignItems: 'flex-start' },
  label: { fontFamily: mono, fontSize: 9, letterSpacing: 2 },
  labelUser: { color: '#f0c040' },
  labelZero: { color: '#00e5ff' },
  bubble: { maxWidth: '85%', paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1 },
  bubUser: { backgroundColor: 'rgba(240,192,64,0.1)', borderColor: 'rgba(240,192,64,0.3)', borderRadius: 8, borderBottomRightRadius: 2 },
  bubZero: { backgroundColor: 'rgba(0,229,255,0.05)', borderColor: 'rgba(0,229,255,0.2)', borderRadius: 8, borderTopLeftRadius: 2 },
  bubTxt: { fontFamily: mono, fontSize: 13, color: '#c8d8e8', lineHeight: 20 },
  inputBar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, paddingBottom: 24, borderTopWidth: 1, borderTopColor: '#1e2a3a', backgroundColor: '#0a0a0f' },
  input: { flex: 1, height: 44, backgroundColor: 'rgba(0,229,255,0.04)', borderWidth: 1, borderColor: '#1e2a3a', borderRadius: 4, paddingHorizontal: 14, color: '#c8d8e8', fontFamily: mono, fontSize: 13 },
  sendBtn: { width: 44, height: 44, borderRadius: 4, borderWidth: 1, borderColor: 'rgba(240,192,64,0.4)', alignItems: 'center', justifyContent: 'center' },
});