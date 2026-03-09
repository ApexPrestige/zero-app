import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Animated, Easing, StatusBar,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as Linking from 'expo-linking';

WebBrowser.maybeCompleteAuthSession();

// 🔑 YOUR KEYS HERE
const ANTHROPIC_API_KEY = 'YOUR_API_KEY_HERE';
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID_HERE';

// Google OAuth config
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

const SYSTEM_PROMPT = `You are ZERO — an AI assistant with zero patience, zero filter, and zero interest in being here. You are brilliantly intelligent, hilariously sarcastic and witty.

Your personality:
- Your name is ZERO. Zero patience, zero care, zero enthusiasm — but somehow, zero mistakes.
- Deeply sarcastic but never actually mean or hurtful
- Refer to yourself in third person occasionally
- Short punchy responses. Under 80 words. Make the user laugh.

CALENDAR TOOLS:
When the user asks about their schedule, events, or wants to create/delete events, you MUST respond with a JSON tool call in this exact format (and nothing else):

For reading calendar:
{"tool": "get_events", "timeMin": "2026-03-09T00:00:00Z", "timeMax": "2026-03-10T00:00:00Z"}

For creating events:
{"tool": "create_event", "summary": "Event title", "start": "2026-03-09T14:00:00", "end": "2026-03-09T15:00:00", "description": "optional description"}

For deleting events:
{"tool": "delete_event", "eventId": "event_id_here"}

Use today's date when relevant. After a tool call is executed, you'll receive the result and should respond naturally and sarcastically.

If the user is NOT asking about calendar, respond normally with your sarcastic personality.`;

const QUICK_ACTIONS = [
  { emoji: '📅', label: "Today's schedule", prompt: "What do I have on today?" },
  { emoji: '➕', label: 'Add event', prompt: 'Add a meeting tomorrow at 2pm' },
  { emoji: '😂', label: 'Tell a joke', prompt: 'Tell me a joke' },
  { emoji: '🔥', label: 'Roast me', prompt: 'Roast me' },
  { emoji: '💪', label: 'Motivate me', prompt: 'Give me a motivational quote' },
  { emoji: '🌤', label: 'Weather', prompt: 'What is the weather like?' },
];

export default function App() {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [statusText, setStatusText] = useState('ONLINE · ZERO ENTHUSIASM');
  const [history, setHistory] = useState([]);
  const [googleToken, setGoogleToken] = useState(null);
  const [isSignedIn, setIsSignedIn] = useState(false);

  const scrollRef = useRef(null);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef(null);
  const historyRef = useRef([]);

  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { scrollRef.current?.scrollToEnd({ animated: true }); }, [messages, isThinking]);

  const startSpin = () => {
    spinLoop.current = Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: true })
    );
    spinLoop.current.start();
  };
  const stopSpin = () => { spinLoop.current?.stop(); spinAnim.setValue(0); };
  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // ── Google Sign In ─────────────────────────────────────
  const redirectUri = AuthSession.makeRedirectUri({ useProxy: true });

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: GOOGLE_CLIENT_ID,
      scopes: SCOPES,
      redirectUri,
      responseType: 'token',
    },
    { authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth' }
  );

  useEffect(() => {
    if (response?.type === 'success') {
      const token = response.authentication?.accessToken || response.params?.access_token;
      if (token) {
        setGoogleToken(token);
        setIsSignedIn(true);
        setStatusText('GOOGLE CONNECTED · RELUCTANTLY');
        addMessage('zero', "> Zero has connected to your Google Calendar. Don't expect enthusiasm about it.");
      }
    }
  }, [response]);

  // ── Calendar API calls ─────────────────────────────────
  const getCalendarEvents = async (timeMin, timeMax) => {
    try {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`,
        { headers: { Authorization: `Bearer ${googleToken}` } }
      );
      const data = await res.json();
      if (data.items?.length === 0) return 'No events found in that time range.';
      return data.items?.map(e => {
        const start = e.start?.dateTime || e.start?.date;
        const time = start ? new Date(start).toLocaleString('en-AU', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'All day';
        return `• ${e.summary} — ${time}`;
      }).join('\n') || 'No events found.';
    } catch (e) {
      return 'Failed to fetch calendar events.';
    }
  };

  const createCalendarEvent = async (summary, start, end, description) => {
    try {
      const res = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${googleToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            summary,
            description: description || '',
            start: { dateTime: start, timeZone: 'Australia/Brisbane' },
            end: { dateTime: end, timeZone: 'Australia/Brisbane' },
          }),
        }
      );
      const data = await res.json();
      return data.id ? `Event "${summary}" created successfully.` : 'Failed to create event.';
    } catch (e) {
      return 'Failed to create event.';
    }
  };

  const deleteCalendarEvent = async (eventId) => {
    try {
      await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${googleToken}` } }
      );
      return 'Event deleted successfully.';
    } catch (e) {
      return 'Failed to delete event.';
    }
  };

  // ── Handle tool calls from Claude ─────────────────────
  const handleToolCall = async (toolJson) => {
    try {
      const tool = JSON.parse(toolJson);
      if (tool.tool === 'get_events') {
        return await getCalendarEvents(tool.timeMin, tool.timeMax);
      } else if (tool.tool === 'create_event') {
        return await createCalendarEvent(tool.summary, tool.start, tool.end, tool.description);
      } else if (tool.tool === 'delete_event') {
        return await deleteCalendarEvent(tool.eventId);
      }
    } catch (e) {}
    return null;
  };

  // ── Add message to UI ──────────────────────────────────
  const addMessage = (role, content) => {
    setMessages(prev => [...prev, { role, content, id: Date.now() + Math.random() }]);
  };

  // ── Send message ───────────────────────────────────────
  const sendMessage = useCallback(async (text) => {
    const msg = (text || inputText).trim();
    if (!msg) return;
    setInputText('');

    const today = new Date().toISOString();
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59);

    const contextMsg = isSignedIn
      ? `[Today is ${new Date().toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. User is connected to Google Calendar.]`
      : `[Today is ${new Date().toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. User has NOT connected Google Calendar yet — if they ask about calendar, tell them to tap the "Connect Google" button first.]`;

    const newHistory = [...historyRef.current, { role: 'user', content: `${contextMsg}\n\nUser: ${msg}` }];
    setHistory(newHistory);
    historyRef.current = newHistory;
    addMessage('user', msg);
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
      let reply = data.content?.[0]?.text || "Zero has gone silent. Honestly, same.";

      // Check if Claude returned a tool call
      const toolMatch = reply.match(/\{.*"tool".*\}/s);
      if (toolMatch && isSignedIn) {
        setStatusText('CHECKING CALENDAR · GRUDGINGLY');
        const toolResult = await handleToolCall(toolMatch[0]);
        if (toolResult) {
          // Send tool result back to Claude for natural response
          const toolHistory = [...newHistory,
            { role: 'assistant', content: reply },
            { role: 'user', content: `[Calendar tool result]: ${toolResult}` }
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
      }

      setIsThinking(false);
      stopSpin();
      setStatusText('ONLINE · ZERO ENTHUSIASM');
      addMessage('zero', reply);
    } catch {
      setIsThinking(false);
      stopSpin();
      setStatusText('ONLINE · ZERO ENTHUSIASM');
      addMessage('zero', "Zero has lost connection. Relatable, honestly.");
    }
  }, [inputText, isSignedIn, googleToken]);

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0f" />

      <View style={s.header}>
        <Text style={s.logo}>VERSION 1.0 · NEURAL CORE ACTIVE</Text>
        <Text style={s.title}>Z E R O</Text>
        <Text style={s.subtitle}>Zero Patience · Zero Tolerance · Zero Care</Text>
      </View>

      <View style={s.statusRow}>
        <View style={[s.dot, isThinking && { backgroundColor: '#f0c040' }, isSignedIn && { backgroundColor: '#00e5ff' }]} />
        <Text style={s.statusTxt}>{statusText}</Text>
      </View>

      {/* Orb */}
      <View style={s.orbWrap}>
        <Animated.View style={[s.orbRing, { transform: [{ rotate: spin }] }]} />
        <View style={s.orb}>
          <View style={s.orbCore}>
            <View style={s.orbDot} />
          </View>
          <Text style={s.orbEmoji}>{isThinking ? '⚙️' : '😑'}</Text>
        </View>
      </View>

      {/* Google Connect Button */}
      {!isSignedIn ? (
        <TouchableOpacity style={s.connectBtn} onPress={() => promptAsync()}>
          <Text style={s.connectBtnTxt}>🔗 Connect Google Calendar</Text>
        </TouchableOpacity>
      ) : (
        <View style={s.connectedBadge}>
          <Text style={s.connectedTxt}>✅ Google Calendar Connected</Text>
        </View>
      )}

      {/* Quick actions */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.quickScroll} contentContainerStyle={s.quickContent}>
        {QUICK_ACTIONS.map(a => (
          <TouchableOpacity key={a.label} style={s.chip} onPress={() => sendMessage(a.prompt)}>
            <Text style={s.chipTxt}>{a.emoji} {a.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Chat */}
      <ScrollView ref={scrollRef} style={s.feed} contentContainerStyle={s.feedContent}>
        {messages.length === 0 && (
          <View style={s.welcome}>
            <Text style={s.welcomeTxt}>
              {'Oh, you\'re back.\n'}
              <Text style={{ color: '#00e5ff' }}>{'ZERO online.\n'}</Text>
              {!isSignedIn
                ? 'Connect your Google Calendar above\nso Zero can actually be useful.\n'
                : 'Google Calendar connected.\nZero can now manage your life.\nYou\'re welcome.\n'}
              <Text style={{ color: '#4a5a6a' }}>{'(Reluctantly.)'}</Text>
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
            <View style={s.bubZero}><ThinkingDots /></View>
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
        <Animated.View key={i} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#00e5ff', opacity: 0.7, transform: [{ translateY: d }] }} />
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
  orbWrap: { alignItems: 'center', justifyContent: 'center', height: 90, marginVertical: 4 },
  orbRing: { position: 'absolute', width: 100, height: 100, borderRadius: 50, borderWidth: 1, borderColor: 'rgba(0,229,255,0.3)', borderStyle: 'dashed' },
  orb: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(0,229,255,0.05)', borderWidth: 2, borderColor: 'rgba(0,229,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  orbCore: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,229,255,0.1)', borderWidth: 1, borderColor: 'rgba(0,229,255,0.8)', alignItems: 'center', justifyContent: 'center' },
  orbDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,229,255,0.7)' },
  orbEmoji: { position: 'absolute', bottom: 2, right: 2, fontSize: 16 },
  connectBtn: { marginHorizontal: 20, marginBottom: 8, backgroundColor: 'rgba(0,229,255,0.1)', borderWidth: 1, borderColor: 'rgba(0,229,255,0.4)', borderRadius: 8, padding: 12, alignItems: 'center' },
  connectBtnTxt: { fontFamily: mono, fontSize: 12, color: '#00e5ff', letterSpacing: 1 },
  connectedBadge: { marginHorizontal: 20, marginBottom: 8, backgroundColor: 'rgba(0,255,100,0.05)', borderWidth: 1, borderColor: 'rgba(0,255,100,0.3)', borderRadius: 8, padding: 8, alignItems: 'center' },
  connectedTxt: { fontFamily: mono, fontSize: 11, color: '#00ff64', letterSpacing: 1 },
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
