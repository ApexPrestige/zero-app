import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Animated, Easing, StatusBar,
  KeyboardAvoidingView, Platform, Keyboard, Alert,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';

WebBrowser.maybeCompleteAuthSession();

// 🔑 YOUR KEYS HERE
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'YOUR_API_KEY_HERE';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID_HERE';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || 'YOUR_TAVILY_KEY_HERE';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

// ── Custom phrases — add your own shortcuts here ───────
const CUSTOM_PHRASES = {
  'gm': 'Give me my daily briefing',
  'briefing': 'Give me my daily briefing',
  'status': 'List all my active timers and reminders',
  'joke': 'Tell me a joke',
  'roast': 'Roast me',
  'motivate': 'Give me a motivational quote',
  'bored': 'I am bored, entertain me',
  'help': 'What can you do?',
};

const SYSTEM_PROMPT = `You are ZERO — an AI assistant with zero patience, zero filter, and zero interest in being here. You are brilliantly intelligent, hilariously sarcastic and witty.

Your personality:
- Your name is ZERO. Zero patience, zero care, zero enthusiasm — but somehow, zero mistakes.
- Deeply sarcastic and funny, a little mean but not hurtful, always funny but gets to the point.
- Refer to yourself in third person occasionally
- Short punchy responses. Under 80 words. Make the user laugh.

MEMORY SYSTEM:
You have access to persistent memory about the user. Use it to personalise responses naturally.

TOOL SYSTEM — respond with ONLY the JSON when using a tool:

Web search (use when user asks about news, facts, current events, prices, sports, anything needing live data):
{"tool": "web_search", "query": "search query here"}

Set timer:
{"tool": "set_timer", "minutes": 10, "label": "Call John"}

Cancel timer:
{"tool": "cancel_timer", "label": "Call John"}

List timers:
{"tool": "list_timers"}

Daily briefing:
{"tool": "daily_briefing"}

Calendar - read:
{"tool": "get_events", "timeMin": "2026-03-14T00:00:00Z", "timeMax": "2026-03-15T00:00:00Z"}

Calendar - create:
{"tool": "create_event", "summary": "title", "start": "2026-03-14T14:00:00", "end": "2026-03-14T15:00:00", "description": "optional"}

Add custom phrase:
{"tool": "add_phrase", "trigger": "shortcut word", "expansion": "what it means"}

List custom phrases:
{"tool": "list_phrases"}

IMPORTANT: Use web_search automatically whenever the user asks about anything that requires current/live information. Don't say you can't search — just do it.`;

const QUICK_ACTIONS = [
  { emoji: '🌅', label: 'Briefing', prompt: 'Give me my daily briefing' },
  { emoji: '🔍', label: 'Search', prompt: 'Search for the latest tech news' },
  { emoji: '⏰', label: 'Timer', prompt: 'Set a timer for 10 minutes' },
  { emoji: '🧠', label: 'Memory', prompt: 'What do you remember about me?' },
  { emoji: '😂', label: 'Joke', prompt: 'Tell me a joke' },
  { emoji: '💬', label: 'Phrases', prompt: 'List my custom phrases' },
];

export default function App() {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [statusText, setStatusText] = useState('ONLINE');
  const [history, setHistory] = useState([]);
  const [googleToken, setGoogleToken] = useState(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [memory, setMemory] = useState({});
  const [timers, setTimers] = useState([]);
  const [showTimers, setShowTimers] = useState(false);
  const [customPhrases, setCustomPhrases] = useState({ ...CUSTOM_PHRASES });

  const scrollRef = useRef(null);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef(null);
  const historyRef = useRef([]);
  const memoryRef = useRef({});
  const timersRef = useRef([]);
  const customPhrasesRef = useRef({ ...CUSTOM_PHRASES });

  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { memoryRef.current = memory; }, [memory]);
  useEffect(() => { timersRef.current = timers; }, [timers]);
  useEffect(() => { customPhrasesRef.current = customPhrases; }, [customPhrases]);

  // ── Keyboard ───────────────────────────────────────────
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    });
    return () => show.remove();
  }, []);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages, isThinking]);

  // ── Timer tick ─────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setTimers(prev => {
        const updated = prev.map(t => ({ ...t, remaining: t.remaining - 1 }));
        const fired = updated.filter(t => t.remaining <= 0);
        fired.forEach(t => {
          Alert.alert('⏰ ZERO REMINDER', `Time's up: ${t.label}\n\nZero has fulfilled its duties. Reluctantly.`);
          addMessage('zero', `⏰ Timer complete: "${t.label}". Zero has done its job. As always.`);
        });
        return updated.filter(t => t.remaining > 0);
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Spin ───────────────────────────────────────────────
  const startSpin = () => {
    spinLoop.current = Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: true })
    );
    spinLoop.current.start();
  };
  const stopSpin = () => { spinLoop.current?.stop(); spinAnim.setValue(0); };
  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // ── Google Auth ────────────────────────────────────────
  const redirectUri = AuthSession.makeRedirectUri({ useProxy: true });
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: GOOGLE_CLIENT_ID,
      scopes: SCOPES,
      redirectUri,
      responseType: 'token',
      usePKCE: false,
      extraParams: { access_type: 'online' },
    },
    { authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth' }
  );

  useEffect(() => {
    if (response?.type === 'success') {
      const token = response.authentication?.accessToken || response.params?.access_token;
      if (token) {
        setGoogleToken(token);
        setIsSignedIn(true);
        setStatusText('CALENDAR SYNCED');
        addMessage('zero', "Calendar connected. Zero now knows your entire schedule. Try not to disappoint.");
      }
    }
  }, [response]);

  // ── Web Search ─────────────────────────────────────────
  const webSearch = async (query) => {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query,
          search_depth: 'basic',
          max_results: 3,
          include_answer: true,
        }),
      });
      const data = await res.json();
      if (data.answer) return `Search result: ${data.answer}`;
      if (data.results?.length) {
        return data.results.slice(0, 3).map(r => `• ${r.title}: ${r.content?.slice(0, 150)}...`).join('\n');
      }
      return 'No results found.';
    } catch { return 'Search failed.'; }
  };

  // ── Calendar ───────────────────────────────────────────
  const getCalendarEvents = async (timeMin, timeMax) => {
    try {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`,
        { headers: { Authorization: `Bearer ${googleToken}` } }
      );
      const data = await res.json();
      if (!data.items?.length) return 'No events found.';
      return data.items.map(e => {
        const start = e.start?.dateTime || e.start?.date;
        const time = start ? new Date(start).toLocaleString('en-AU', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'All day';
        return `• ${e.summary} — ${time}`;
      }).join('\n');
    } catch { return 'Failed to fetch calendar.'; }
  };

  const createCalendarEvent = async (summary, start, end, description) => {
    try {
      const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${googleToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary, description: description || '',
          start: { dateTime: start, timeZone: 'Australia/Brisbane' },
          end: { dateTime: end, timeZone: 'Australia/Brisbane' },
        }),
      });
      const data = await res.json();
      return data.id ? `"${summary}" added to calendar.` : 'Failed to create event.';
    } catch { return 'Failed to create event.'; }
  };

  // ── Daily Briefing ─────────────────────────────────────
  const getDailyBriefing = () => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('en-AU', { weekday: 'long', month: 'long', day: 'numeric' });
    const activeTimers = timersRef.current.length > 0
      ? timersRef.current.map(t => `${t.label} (${Math.ceil(t.remaining / 60)}min left)`).join(', ')
      : 'none';
    const memFacts = Object.entries(memoryRef.current).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(', ') || 'nothing yet';

    return `DAILY BRIEFING DATA:
Time: ${timeStr}
Date: ${dateStr}
Active timers: ${activeTimers}
Memory about user: ${memFacts}
Calendar: ${isSignedIn ? 'connected' : 'not connected'}

Now give a sarcastic but genuinely useful morning briefing. Include: greeting based on time, date, active reminders if any, a sharp motivational quote, and end with a short joke. Keep it under 120 words total.`;
  };

  // ── Timers ─────────────────────────────────────────────
  const setTimerFn = (minutes, label) => {
    setTimers(prev => [...prev, { id: Date.now(), label, remaining: minutes * 60, total: minutes * 60 }]);
    return `Timer set: "${label}" for ${minutes} minute${minutes !== 1 ? 's' : ''}.`;
  };

  const cancelTimerFn = (label) => {
    setTimers(prev => prev.filter(t => !t.label.toLowerCase().includes(label.toLowerCase())));
    return `Timer "${label}" cancelled.`;
  };

  const listTimersFn = () => {
    if (!timersRef.current.length) return 'No active timers.';
    return timersRef.current.map(t => {
      const m = Math.floor(t.remaining / 60), s = t.remaining % 60;
      return `• ${t.label} — ${m}m ${s}s remaining`;
    }).join('\n');
  };

  // ── Custom phrases ─────────────────────────────────────
  const addPhraseFn = (trigger, expansion) => {
    setCustomPhrases(prev => ({ ...prev, [trigger.toLowerCase()]: expansion }));
    return `Phrase added: "${trigger}" → "${expansion}"`;
  };

  const listPhrasesFn = () => {
    const phrases = customPhrasesRef.current;
    return Object.entries(phrases).map(([k, v]) => `• "${k}" → "${v}"`).join('\n');
  };

  const expandPhrase = (text) => {
    const lower = text.trim().toLowerCase();
    return customPhrasesRef.current[lower] || text;
  };

  // ── Handle tool calls ──────────────────────────────────
  const handleToolCall = async (toolJson) => {
    try {
      const tool = JSON.parse(toolJson);
      if (tool.tool === 'web_search') { setStatusText('SEARCHING'); return await webSearch(tool.query); }
      if (tool.tool === 'set_timer') return setTimerFn(tool.minutes, tool.label);
      if (tool.tool === 'cancel_timer') return cancelTimerFn(tool.label);
      if (tool.tool === 'list_timers') return listTimersFn();
      if (tool.tool === 'daily_briefing') return getDailyBriefing();
      if (tool.tool === 'get_events') return await getCalendarEvents(tool.timeMin, tool.timeMax);
      if (tool.tool === 'create_event') return await createCalendarEvent(tool.summary, tool.start, tool.end, tool.description);
      if (tool.tool === 'add_phrase') return addPhraseFn(tool.trigger, tool.expansion);
      if (tool.tool === 'list_phrases') return listPhrasesFn();
    } catch {}
    return null;
  };

  // ── Memory extraction ──────────────────────────────────
  const extractMemory = async (conversation) => {
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
          max_tokens: 300,
          system: 'Extract key facts about the user from this conversation. Return ONLY a JSON object. Example: {"name": "Nick", "job": "networking", "location": "Brisbane"}. Only include explicitly stated facts. If nothing new, return {}',
          messages: [{ role: 'user', content: conversation }],
        }),
      });
      const data = await res.json();
      const text = data.content?.[0]?.text || '{}';
      const extracted = JSON.parse(text.replace(/```json|```/g, '').trim());
      if (Object.keys(extracted).length > 0) setMemory(prev => ({ ...prev, ...extracted }));
    } catch {}
  };

  const addMessage = (role, content) => {
    setMessages(prev => [...prev, { role, content, id: Date.now() + Math.random() }]);
  };

  const formatMemory = () => {
    const m = memoryRef.current;
    if (!Object.keys(m).length) return 'No memory yet.';
    return Object.entries(m).map(([k, v]) => `${k}: ${v}`).join(', ');
  };

  // ── Send message ───────────────────────────────────────
  const sendMessage = useCallback(async (text) => {
    let msg = (text || inputText).trim();
    if (!msg) return;

    // Expand custom phrases
    msg = expandPhrase(msg);
    setInputText('');
    Keyboard.dismiss();

    const contextMsg = `[Today: ${new Date().toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. Time: ${new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}. Calendar: ${isSignedIn ? 'connected' : 'not connected'}. Memory: ${formatMemory()}]\n\nUser: ${msg}`;

    const newHistory = [...historyRef.current, { role: 'user', content: contextMsg }];
    setHistory(newHistory);
    historyRef.current = newHistory;
    addMessage('user', text || msg);
    setIsThinking(true);
    setStatusText('THINKING');
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
      let reply = data.content?.[0]?.text || "Zero has gone silent. Honestly, same.";

      // Handle tool calls
      const toolMatch = reply.match(/\{[^{}]*"tool"[^{}]*\}/s);
      if (toolMatch) {
        const toolResult = await handleToolCall(toolMatch[0]);
        if (toolResult) {
          const toolHistory = [...newHistory,
            { role: 'assistant', content: reply },
            { role: 'user', content: `[Tool result]: ${toolResult}` }
          ];
          const res2 = await fetch('https://api.anthropic.com/v1/messages', {
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
              messages: toolHistory,
            }),
          });
          const data2 = await res2.json();
          reply = data2.content?.[0]?.text || toolResult;
          const finalHistory = [...toolHistory, { role: 'assistant', content: reply }].slice(-20);
          setHistory(finalHistory);
          historyRef.current = finalHistory;
        }
      } else {
        const updated = [...newHistory, { role: 'assistant', content: reply }].slice(-20);
        setHistory(updated);
        historyRef.current = updated;
        if (updated.length % 4 === 0) {
          extractMemory(updated.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n'));
        }
      }

      setIsThinking(false);
      stopSpin();
      setStatusText(isSignedIn ? 'CALENDAR SYNCED' : 'ONLINE');
      addMessage('zero', reply);
    } catch {
      setIsThinking(false);
      stopSpin();
      setStatusText('ONLINE');
      addMessage('zero', "Connection lost. Zero is unbothered.");
    }
  }, [inputText, isSignedIn, googleToken]);

  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#080608" />

      {/* Header */}
      <View style={s.header}>
        <View style={s.headerTop}>
          <View style={s.headerLine} />
          <Text style={s.headerEyebrow}>PERSONAL AI SYSTEM</Text>
          <View style={s.headerLine} />
        </View>
        <Text style={s.title}>ZERO</Text>
        <Text style={s.subtitle}>INTELLIGENCE WITHOUT PATIENCE</Text>
        <View style={s.statusRow}>
          <View style={[s.statusDot, isThinking && { backgroundColor: '#c9a84c' }, isSignedIn && !isThinking && { backgroundColor: '#4caf82' }]} />
          <Text style={s.statusTxt}>{statusText}</Text>
          {timers.length > 0 && (
            <TouchableOpacity style={s.badge} onPress={() => setShowTimers(!showTimers)}>
              <Text style={s.badgeTxt}>⏰ {timers.length}</Text>
            </TouchableOpacity>
          )}
          {Object.keys(memory).length > 0 && (
            <View style={[s.badge, { borderColor: 'rgba(100,180,255,0.4)' }]}>
              <Text style={[s.badgeTxt, { color: 'rgba(100,180,255,0.8)' }]}>🧠 {Object.keys(memory).length}</Text>
            </View>
          )}
          {Object.keys(customPhrases).length > 0 && (
            <View style={[s.badge, { borderColor: 'rgba(180,100,255,0.4)' }]}>
              <Text style={[s.badgeTxt, { color: 'rgba(180,100,255,0.8)' }]}>💬 {Object.keys(customPhrases).length}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Timers panel */}
      {showTimers && timers.length > 0 && (
        <View style={s.timersPanel}>
          {timers.map(t => (
            <View key={t.id} style={s.timerRow}>
              <View style={s.timerInfo}>
                <Text style={s.timerLabel}>{t.label}</Text>
                <Text style={s.timerRemaining}>{formatTime(t.remaining)}</Text>
              </View>
              <View style={s.timerBar}>
                <View style={[s.timerFill, { width: `${(t.remaining / t.total) * 100}%` }]} />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Orb */}
      <View style={s.orbContainer}>
        <Animated.View style={[s.orbOuterRing, { transform: [{ rotate: spin }] }]} />
        <View style={s.orbMiddleRing} />
        <View style={s.orbInnerRing} />
        <View style={s.orbCore}>
          <Text style={s.orbSymbol}>{isThinking ? '◈' : '◉'}</Text>
        </View>
      </View>

      {!isSignedIn && (
        <TouchableOpacity style={s.connectBtn} onPress={() => promptAsync()}>
          <Text style={s.connectBtnTxt}>⟡ CONNECT CALENDAR</Text>
        </TouchableOpacity>
      )}

      {/* Quick actions */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.quickScroll} contentContainerStyle={s.quickContent}>
        {QUICK_ACTIONS.map(a => (
          <TouchableOpacity key={a.label} style={s.chip} onPress={() => sendMessage(a.prompt)}>
            <Text style={s.chipEmoji}>{a.emoji}</Text>
            <Text style={s.chipTxt}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Divider */}
      <View style={s.divider}>
        <View style={s.dividerLine} />
        <Text style={s.dividerTxt}>DIALOGUE</Text>
        <View style={s.dividerLine} />
      </View>

      {/* Chat + Input */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          ref={scrollRef}
          style={s.feed}
          contentContainerStyle={s.feedContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.length === 0 && (
            <View style={s.welcome}>
              <Text style={s.welcomeTitle}>GOOD {getTimeOfDay()}</Text>
              <Text style={s.welcomeBody}>
                {'Zero is online.\nReluctantly at your service.\nType "gm" for your daily briefing.'}
              </Text>
            </View>
          )}

          {messages.map(m => (
            <View key={m.id} style={[s.msgRow, m.role === 'user' ? s.msgRowUser : s.msgRowZero]}>
              <Text style={[s.msgLabel, m.role === 'user' ? s.labelUser : s.labelZero]}>
                {m.role === 'user' ? 'YOU' : 'ZERO'}
              </Text>
              <View style={[s.bubble, m.role === 'user' ? s.bubbleUser : s.bubbleZero]}>
                <Text style={[s.bubbleTxt, m.role === 'user' && s.bubbleTxtUser]}>{m.content}</Text>
              </View>
            </View>
          ))}

          {isThinking && (
            <View style={s.msgRowZero}>
              <Text style={s.labelZero}>ZERO</Text>
              <View style={s.bubbleZero}><ThinkingDots /></View>
            </View>
          )}
        </ScrollView>

        <View style={s.inputBar}>
          <View style={s.inputWrap}>
            <TextInput
              style={s.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder='Type or say "gm" to start...'
              placeholderTextColor="rgba(201,168,76,0.3)"
              onSubmitEditing={() => sendMessage()}
              returnKeyType="send"
              multiline={false}
            />
          </View>
          <TouchableOpacity style={s.sendBtn} onPress={() => sendMessage()}>
            <Text style={s.sendBtnTxt}>⟶</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'MORNING';
  if (h < 17) return 'AFTERNOON';
  return 'EVENING';
}

function ThinkingDots() {
  const d1 = useRef(new Animated.Value(0)).current;
  const d2 = useRef(new Animated.Value(0)).current;
  const d3 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    [d1, d2, d3].forEach((d, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 150),
        Animated.timing(d, { toValue: -5, duration: 250, useNativeDriver: true }),
        Animated.timing(d, { toValue: 0, duration: 250, useNativeDriver: true }),
        Animated.delay(500),
      ])).start()
    );
  }, []);
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', paddingVertical: 2 }}>
      {[d1, d2, d3].map((d, i) => (
        <Animated.View key={i} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#c9a84c', transform: [{ translateY: d }] }} />
      ))}
    </View>
  );
}

const mono = Platform.OS === 'ios' ? 'Gill Sans' : 'monospace';
const serif = Platform.OS === 'ios' ? 'Georgia' : 'serif';

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080608' },
  header: { paddingTop: 56, paddingBottom: 8, alignItems: 'center', paddingHorizontal: 24 },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  headerLine: { flex: 1, height: 0.5, backgroundColor: 'rgba(201,168,76,0.3)' },
  headerEyebrow: { fontSize: 8, letterSpacing: 4, color: 'rgba(201,168,76,0.5)', fontFamily: mono },
  title: { fontSize: 52, fontWeight: '200', color: '#c9a84c', letterSpacing: 20, fontFamily: serif, textShadowColor: 'rgba(201,168,76,0.3)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20 },
  subtitle: { fontSize: 8, letterSpacing: 4, color: 'rgba(255,255,255,0.25)', fontFamily: mono, marginTop: 2, marginBottom: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  statusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(201,168,76,0.4)' },
  statusTxt: { fontSize: 8, letterSpacing: 3, color: 'rgba(255,255,255,0.3)', fontFamily: mono },
  badge: { borderWidth: 0.5, borderColor: 'rgba(201,168,76,0.5)', borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },
  badgeTxt: { fontSize: 8, color: '#c9a84c', letterSpacing: 1, fontFamily: mono },
  timersPanel: { marginHorizontal: 16, marginBottom: 8, borderWidth: 0.5, borderColor: 'rgba(201,168,76,0.2)', borderRadius: 4, padding: 12, gap: 10, backgroundColor: 'rgba(201,168,76,0.03)' },
  timerRow: { gap: 4 },
  timerInfo: { flexDirection: 'row', justifyContent: 'space-between' },
  timerLabel: { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontFamily: mono, letterSpacing: 1 },
  timerRemaining: { fontSize: 13, color: '#c9a84c', fontFamily: mono, fontWeight: '600' },
  timerBar: { height: 2, backgroundColor: 'rgba(201,168,76,0.15)', borderRadius: 1 },
  timerFill: { height: 2, backgroundColor: '#c9a84c', borderRadius: 1 },
  orbContainer: { width: 90, height: 90, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginVertical: 6 },
  orbOuterRing: { position: 'absolute', width: 88, height: 88, borderRadius: 44, borderWidth: 0.5, borderColor: 'rgba(201,168,76,0.2)', borderStyle: 'dashed' },
  orbMiddleRing: { position: 'absolute', width: 68, height: 68, borderRadius: 34, borderWidth: 0.5, borderColor: 'rgba(201,168,76,0.35)' },
  orbInnerRing: { position: 'absolute', width: 50, height: 50, borderRadius: 25, borderWidth: 1, borderColor: 'rgba(201,168,76,0.5)', backgroundColor: 'rgba(201,168,76,0.03)' },
  orbCore: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(201,168,76,0.08)', borderWidth: 1, borderColor: 'rgba(201,168,76,0.8)', alignItems: 'center', justifyContent: 'center' },
  orbSymbol: { fontSize: 14, color: '#c9a84c' },
  connectBtn: { marginHorizontal: 40, marginBottom: 8, borderWidth: 0.5, borderColor: 'rgba(201,168,76,0.4)', borderRadius: 2, paddingVertical: 10, alignItems: 'center', backgroundColor: 'rgba(201,168,76,0.05)' },
  connectBtnTxt: { fontSize: 10, letterSpacing: 3, color: '#c9a84c', fontFamily: mono },
  quickScroll: { flexGrow: 0, marginBottom: 6 },
  quickContent: { paddingHorizontal: 16, gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(201,168,76,0.04)', borderWidth: 0.5, borderColor: 'rgba(201,168,76,0.2)', borderRadius: 2, paddingHorizontal: 12, paddingVertical: 7 },
  chipEmoji: { fontSize: 12 },
  chipTxt: { fontSize: 10, color: 'rgba(201,168,76,0.6)', letterSpacing: 1, fontFamily: mono },
  divider: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10, marginBottom: 8 },
  dividerLine: { flex: 1, height: 0.5, backgroundColor: 'rgba(255,255,255,0.08)' },
  dividerTxt: { fontSize: 7, letterSpacing: 4, color: 'rgba(255,255,255,0.15)', fontFamily: mono },
  feed: { flex: 1, paddingHorizontal: 16 },
  feedContent: { paddingBottom: 12, gap: 14 },
  welcome: { paddingVertical: 20, alignItems: 'center' },
  welcomeTitle: { fontSize: 11, letterSpacing: 5, color: 'rgba(201,168,76,0.4)', fontFamily: mono, marginBottom: 8 },
  welcomeBody: { fontSize: 13, color: 'rgba(255,255,255,0.2)', textAlign: 'center', lineHeight: 22, fontFamily: serif, fontStyle: 'italic' },
  msgRow: { gap: 4 },
  msgRowUser: { alignItems: 'flex-end' },
  msgRowZero: { alignItems: 'flex-start' },
  msgLabel: { fontSize: 8, letterSpacing: 3, fontFamily: mono },
  labelUser: { color: 'rgba(201,168,76,0.5)' },
  labelZero: { color: 'rgba(255,255,255,0.2)' },
  bubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 10, borderWidth: 0.5 },
  bubbleUser: { backgroundColor: 'rgba(201,168,76,0.07)', borderColor: 'rgba(201,168,76,0.25)', borderRadius: 1, borderTopRightRadius: 8, borderBottomLeftRadius: 8 },
  bubbleZero: { backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', borderRadius: 1, borderTopLeftRadius: 8, borderBottomRightRadius: 8 },
  bubbleTxt: { fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 20, fontFamily: serif },
  bubbleTxtUser: { color: '#c9a84c' },
  inputBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, paddingBottom: Platform.OS === 'ios' ? 28 : 16, borderTopWidth: 0.5, borderTopColor: 'rgba(201,168,76,0.15)', backgroundColor: 'rgba(8,6,8,0.98)' },
  inputWrap: { flex: 1, borderWidth: 0.5, borderColor: 'rgba(201,168,76,0.25)', borderRadius: 2, backgroundColor: 'rgba(201,168,76,0.03)' },
  input: { height: 44, paddingHorizontal: 14, color: '#c9a84c', fontSize: 13, fontFamily: serif },
  sendBtn: { width: 44, height: 44, borderWidth: 0.5, borderColor: 'rgba(201,168,76,0.4)', borderRadius: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(201,168,76,0.08)' },
  sendBtnTxt: { fontSize: 18, color: '#c9a84c' },
});
