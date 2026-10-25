import { StatusBar } from 'expo-status-bar';
import { BlurView } from 'expo-blur';
import { useEffect, useRef, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

type StormSeverity = 'light' | 'moderate' | 'severe';
type DemoLocation = { id: string; label: string; description: string };
type ChartPoint = { repair_count: number; hours: number };
type WeatherAlert = {
  event?: string | null;
  headline?: string | null;
  severity?: string | null;
  effective?: string | null;
  expires?: string | null;
};
type Weather = {
  status: 'available' | 'unavailable';
  source: string;
  fetched_at?: string;
  stale: boolean;
  current_stale: boolean;
  current: {
    temperature_f: number | null;
    description: string;
    wind_mph: number | null;
    wind_direction: string | null;
    observed_at: string | null;
  } | null;
  forecast: {
    period: string | null;
    temperature_f: number | null;
    short_forecast: string | null;
    precipitation_probability: number | null;
    starts_at: string | null;
  } | null;
  alerts: WeatherAlert[];
  message?: string;
};
type Analysis = {
  location: { id: string; label: string };
  risk: {
    index: number;
    band: string;
    confidence: string;
    basis: string;
    factors: { label: string; contribution: number }[];
    limitations: string[];
  };
  restoration: {
    range_hours: { low: number; central: number; high: number };
    direct_labor_hours: number;
    adjusted_labor_hours: number;
    repair_count: number;
    crew_size: number;
    install_hours_per_pole: number;
    removal_hours_per_pole: number;
    indirect_multiplier: number;
    assumptions: string[];
    status: string;
  };
  alert: { eligible: boolean; rule: string; message: string; delivery: string };
  preparation: string[];
  chart: ChartPoint[];
  weather: Weather;
};
type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  visualization?: ChartPoint[] | null;
};

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail ?? `Request failed (${response.status}).`);
  }
  return payload as T;
}

function formatTimestamp(value?: string | null): string {
  if (!value) return 'time unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function Pill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.pill, selected && styles.pillSelected]}
    >
      <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function ScenarioChart({
  points,
  selectedCount,
}: {
  points: ChartPoint[];
  selectedCount?: number;
}) {
  const maxHours = Math.max(...points.map((point) => point.hours), 1);
  return (
    <View style={styles.chart} accessibilityLabel="Estimated restoration hours by damaged pole count">
      {points.map((point) => (
        <View key={point.repair_count} style={styles.chartColumn}>
          <Text style={styles.chartValue}>{point.hours}h</Text>
          <View style={styles.chartTrack}>
            <View
              style={[
                styles.chartBar,
                { height: `${Math.max((point.hours / maxHours) * 100, 4)}%` },
                selectedCount === point.repair_count && styles.chartBarSelected,
              ]}
            />
          </View>
          <Text style={styles.chartLabel}>{point.repair_count} pole{point.repair_count > 1 ? 's' : ''}</Text>
        </View>
      ))}
    </View>
  );
}

export default function App() {
  const [locations, setLocations] = useState<DemoLocation[]>([]);
  const [locationId, setLocationId] = useState('');
  const [stormSeverity, setStormSeverity] = useState<StormSeverity>('moderate');
  const [repairCount, setRepairCount] = useState(1);
  const [crewSize, setCrewSize] = useState(2);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [screen, setScreen] = useState<'overview' | 'assistant'>('overview');
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Hi! I can explain this demo risk estimate, compare repair scenarios, or suggest storm preparations.',
    },
  ]);
  const overviewScrollRef = useRef<ScrollViewInstance | null>(null);
  const chatScrollRef = useRef<ScrollViewInstance | null>(null);
  const [weatherOffset, setWeatherOffset] = useState(0);
  const [activeNavigation, setActiveNavigation] = useState<'outlook' | 'weather'>('outlook');

  useEffect(() => {
    const keyboardSubscription = Keyboard.addListener('keyboardDidShow', () => {
      requestAnimationFrame(() => chatScrollRef.current?.scrollToEnd({ animated: true }));
    });
    return () => keyboardSubscription.remove();
  }, []);

  useEffect(() => {
    if (screen === 'assistant') {
      requestAnimationFrame(() => chatScrollRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages, screen]);

  useEffect(() => {
    let active = true;
    request<{ locations: DemoLocation[] }>('/api/locations')
      .then((payload) => {
        if (!active) return;
        setLocations(payload.locations);
        setLocationId(payload.locations[0]?.id ?? '');
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load demo locations.');
      })
      .finally(() => {
        if (active) setLocationsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!locationId) return;
    let active = true;
    setLoading(true);
    setError('');
    request<Analysis>('/api/analyze', {
      location_id: locationId,
      storm_severity: stormSeverity,
      repair_count: repairCount,
      crew_size: crewSize,
    })
      .then((result) => {
        if (active) setAnalysis(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not calculate this scenario.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locationId, stormSeverity, repairCount, crewSize]);

  async function sendQuestion(text = question) {
    const submitted = text.trim();
    if (!submitted || !locationId || sending) return;
    setQuestion('');
    setSending(true);
    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      text: submitted,
    };
    setMessages((current) => [...current, userMessage]);
    try {
      const response = await request<{ answer: string; visualization: ChartPoint[] | null }>(
        '/api/assistant',
        {
          location_id: locationId,
          storm_severity: stormSeverity,
          repair_count: repairCount,
          crew_size: crewSize,
          question: submitted,
        },
      );
      setMessages((current) => [
        ...current,
        {
          id: `${Date.now()}-assistant`,
          role: 'assistant',
          text: response.answer,
          visualization: response.visualization,
        },
      ]);
    } catch (cause) {
      setMessages((current) => [
        ...current,
        {
          id: `${Date.now()}-error`,
          role: 'assistant',
          text: cause instanceof Error ? cause.message : 'The assistant request failed.',
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function navigateOverview(section: 'outlook' | 'weather') {
    setActiveNavigation(section);
    overviewScrollRef.current?.scrollTo({
      y: section === 'weather' ? weatherOffset : 0,
      animated: true,
    });
  }

  const locationLabel = locations.find((location) => location.id === locationId)?.label;

  return (
    <SafeAreaProvider>
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.topBar}>
        <View style={styles.brandMark}><Text style={styles.brandBolt}>↯</Text></View>
        <View style={styles.brandTextWrap}>
          <Text style={styles.brand}>OUTAGE CONCIERGE</Text>
          <Text style={styles.brandSub}>A storm planning companion</Text>
        </View>
        <View style={styles.demoBadge}><Text style={styles.demoBadgeText}>DEMO</Text></View>
      </View>

      {screen === 'overview' ? (
        <ScrollView
          ref={overviewScrollRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          onScroll={(event) => {
            if (weatherOffset > 0) {
              setActiveNavigation(event.nativeEvent.contentOffset.y >= weatherOffset - 80 ? 'weather' : 'outlook');
            }
          }}
          scrollEventThrottle={16}
        >
          <Text style={styles.eyebrow}>PLAN AHEAD</Text>
          <Text style={styles.heading}>Your storm outlook</Text>
          <Text style={styles.subtitle}>Explore a transparent scenario using anonymized challenge data.</Text>

          <Card>
            <Text style={styles.sectionLabel}>SAMPLE AREA</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
              {locations.map((location) => (
                <Pill
                  key={location.id}
                  label={location.label}
                  selected={location.id === locationId}
                  onPress={() => setLocationId(location.id)}
                />
              ))}
            </ScrollView>
            <Text style={[styles.sectionLabel, styles.spacedLabel]}>SIMULATED STORM SEVERITY</Text>
            <View style={styles.pillRow}>
              {([
                ['light', 'Lower'],
                ['moderate', 'Moderate'],
                ['severe', 'Higher'],
              ] as const).map(([value, label]) => (
                <Pill
                  key={value}
                  label={label}
                  selected={stormSeverity === value}
                  onPress={() => setStormSeverity(value)}
                />
              ))}
            </View>
          </Card>

          {analysis?.weather ? (
            <View onLayout={(event) => setWeatherOffset(event.nativeEvent.layout.y)}>
            <Card style={analysis.weather.status !== 'available' ? styles.weatherUnavailable : undefined}>
              <View style={styles.cardTopline}>
                <View>
                  <Text style={styles.sectionLabel}>CURRENT WEATHER</Text>
                  <Text style={styles.cardTitle}>{analysis.weather.source}</Text>
                </View>
                <Text style={styles.weatherFreshness}>
                  {analysis.weather.status !== 'available' ? 'OFFLINE' : analysis.weather.current_stale ? 'DELAYED' : analysis.weather.stale ? 'CACHED' : 'LIVE'}
                </Text>
              </View>
              <Text style={styles.weatherMeta}>Sample GIS circuits are in southwest Virginia; weather uses rounded circuit centers, not customer addresses.</Text>

              {analysis.weather.current ? (
                <View style={styles.weatherCurrent}>
                  <Text style={styles.weatherTemperature}>
                    {analysis.weather.current.temperature_f === null ? '—' : `${analysis.weather.current.temperature_f}°`}
                  </Text>
                  <View style={styles.weatherCurrentDetails}>
                    <Text style={styles.weatherDescription}>{analysis.weather.current.description}</Text>
                    {analysis.weather.current.wind_mph !== null ? (
                      <Text style={styles.weatherMeta}>
                        Wind {analysis.weather.current.wind_mph} mph{analysis.weather.current.wind_direction ? ` ${analysis.weather.current.wind_direction}` : ''}
                      </Text>
                    ) : null}
                    <Text style={styles.weatherMeta}>Observed {formatTimestamp(analysis.weather.current.observed_at)}</Text>
                  </View>
                </View>
              ) : null}

              {analysis.weather.forecast ? (
                <View style={styles.weatherForecast}>
                  <Text style={styles.sectionLabel}>{analysis.weather.forecast.period ?? 'NEXT FORECAST'}</Text>
                  <Text style={styles.bodyText}>
                    {analysis.weather.forecast.short_forecast ?? 'Forecast details unavailable'}
                    {analysis.weather.forecast.temperature_f !== null ? `, ${analysis.weather.forecast.temperature_f}°F` : ''}
                    {analysis.weather.forecast.precipitation_probability !== null ? `, ${analysis.weather.forecast.precipitation_probability}% chance of precipitation` : ''}
                  </Text>
                </View>
              ) : null}

              <View style={styles.weatherAlerts}>
                <Text style={styles.sectionLabel}>OFFICIAL WEATHER ALERTS</Text>
                {analysis.weather.status !== 'available' ? (
                  <Text style={styles.weatherMeta}>{analysis.weather.message ?? 'Live weather is temporarily unavailable.'}</Text>
                ) : analysis.weather.alerts.length ? (
                  analysis.weather.alerts.map((alert, index) => (
                    <View key={`${alert.event ?? 'alert'}-${index}`} style={styles.weatherAlert}>
                      <Text style={styles.weatherDescription}>{alert.event ?? 'Weather alert'}</Text>
                      {alert.headline ? <Text style={styles.weatherMeta}>{alert.headline}</Text> : null}
                      {alert.severity ? <Text style={styles.weatherMeta}>Severity: {alert.severity}</Text> : null}
                    </View>
                  ))
                ) : (
                  <Text style={styles.weatherMeta}>No active NWS alerts for this sample area.</Text>
                )}
              </View>

              {analysis.weather.status === 'available' ? (
                <Text style={styles.chartFootnote}>
                  {analysis.weather.stale ? 'Cached data. ' : ''}
                  {analysis.weather.current_stale ? 'Latest station observation is over 90 minutes old. ' : ''}
                  Updated {formatTimestamp(analysis.weather.fetched_at)}. Weather is regional context and does not change the outage-risk score.
                </Text>
              ) : null}
            </Card>
            </View>
          ) : null}

          {error ? (
            <Card style={styles.errorCard}>
              <Text style={styles.errorTitle}>Can’t reach the demo API</Text>
              <Text style={styles.errorText}>{error}</Text>
              <Text style={styles.helperText}>Start the backend and confirm the API URL in mobile/.env.</Text>
            </Card>
          ) : null}

          {(locationsLoading || loading) && !analysis ? (
            <Card style={styles.loadingCard}>
              <ActivityIndicator color="#148477" />
              <Text style={styles.helperText}>Loading the scenario…</Text>
            </Card>
          ) : null}

          {analysis ? (
            <>
              <Card style={styles.riskCard}>
                <View style={styles.cardTopline}>
                  <Text style={styles.sectionLabel}>RELATIVE OUTAGE RISK</Text>
                  <View style={[styles.riskBadge, analysis.risk.band === 'Higher' && styles.riskBadgeHigh]}>
                    <Text style={styles.riskBadgeText}>{analysis.risk.band.toUpperCase()}</Text>
                  </View>
                </View>
                <View style={styles.riskScoreRow}>
                  <Text style={styles.riskScore}>{analysis.risk.index}</Text>
                  <Text style={styles.riskOutOf}>/ 100</Text>
                </View>
                <View style={styles.riskMeter}>
                  <View style={[styles.riskMeterFill, { width: `${analysis.risk.index}%` }]} />
                </View>
                <Text style={styles.confidence}>◌  {analysis.risk.confidence} confidence</Text>
                <Text style={styles.bodyText}>{analysis.risk.basis}</Text>
                <View style={styles.factorList}>
                  {analysis.risk.factors.map((factor) => (
                    <View key={factor.label} style={styles.factorRow}>
                      <Text style={styles.factorName}>{factor.label}</Text>
                      <Text style={styles.factorScore}>+{factor.contribution}</Text>
                    </View>
                  ))}
                </View>
              </Card>

              <Card>
                <View style={styles.cardTopline}>
                  <View>
                    <Text style={styles.sectionLabel}>RESTORATION SCENARIO</Text>
                    <Text style={styles.cardTitle}>Plan for a range</Text>
                  </View>
                  <Text style={styles.timerIcon}>◷</Text>
                </View>
                <View style={styles.rangeRow}>
                  <View>
                    <Text style={styles.rangeHours}>{analysis.restoration.range_hours.low}–{analysis.restoration.range_hours.high}</Text>
                    <Text style={styles.rangeUnit}>estimated hours</Text>
                  </View>
                  <View style={styles.centralPill}>
                    <Text style={styles.centralCaption}>CENTRAL</Text>
                    <Text style={styles.centralValue}>{analysis.restoration.range_hours.central}h</Text>
                  </View>
                </View>
                <Text style={styles.bodyText}>{analysis.restoration.status}</Text>
                <View style={styles.controlRow}>
                  <View>
                    <Text style={styles.controlLabel}>Assumed pole repairs</Text>
                    <Text style={styles.controlHint}>Change the damage scenario</Text>
                  </View>
                  <View style={styles.stepper}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Fewer pole repairs" style={styles.stepButton} onPress={() => setRepairCount((value) => Math.max(1, value - 1))}>
                      <Text style={styles.stepText}>−</Text>
                    </Pressable>
                    <Text style={styles.stepValue}>{repairCount}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="More pole repairs" style={styles.stepButton} onPress={() => setRepairCount((value) => Math.min(4, value + 1))}>
                      <Text style={styles.stepText}>+</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={styles.controlRow}>
                  <View>
                    <Text style={styles.controlLabel}>Qualified workers</Text>
                    <Text style={styles.controlHint}>Simulated crew size</Text>
                  </View>
                  <View style={styles.stepper}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Fewer qualified workers" style={styles.stepButton} onPress={() => setCrewSize((value) => Math.max(1, value - 1))}>
                      <Text style={styles.stepText}>−</Text>
                    </Pressable>
                    <Text style={styles.stepValue}>{crewSize}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="More qualified workers" style={styles.stepButton} onPress={() => setCrewSize((value) => Math.min(4, value + 1))}>
                      <Text style={styles.stepText}>+</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={styles.assumptionList}>
                  {analysis.restoration.assumptions.map((assumption) => (
                    <Text key={assumption} style={styles.assumption}>•  {assumption}</Text>
                  ))}
                </View>
              </Card>

              <Card>
                <View style={styles.cardTopline}>
                  <View>
                    <Text style={styles.sectionLabel}>SCENARIO COMPARISON</Text>
                    <Text style={styles.cardTitle}>More repairs, more work</Text>
                  </View>
                  <Text style={styles.chartIcon}>▥</Text>
                </View>
                <ScenarioChart points={analysis.chart} selectedCount={repairCount} />
                <Text style={styles.chartFootnote}>Central planning estimate by assumed damaged pole count.</Text>
              </Card>

              <Card style={analysis.alert.eligible ? styles.alertCard : undefined}>
                <View style={styles.cardTopline}>
                  <View>
                    <Text style={styles.sectionLabel}>PROACTIVE COMMUNICATION</Text>
                    <Text style={styles.cardTitle}>{analysis.alert.eligible ? 'Suggested storm alert' : 'General preparation'}</Text>
                  </View>
                  <Text style={styles.alertIcon}>{analysis.alert.eligible ? '↗' : '✓'}</Text>
                </View>
                <Text style={styles.bodyText}>{analysis.alert.message}</Text>
                <Text style={styles.chartFootnote}>{analysis.alert.rule} {analysis.alert.delivery}</Text>
              </Card>

              <Card style={styles.prepCard}>
                <Text style={styles.sectionLabel}>A FEW WAYS TO PREPARE</Text>
                {analysis.preparation.map((step, index) => (
                  <View style={styles.prepRow} key={step}>
                    <Text style={styles.prepNumber}>0{index + 1}</Text>
                    <Text style={styles.prepText}>{step}</Text>
                  </View>
                ))}
              </Card>

              <View style={styles.disclaimer}>
                <Text style={styles.disclaimerTitle}>A transparent demo, not a utility prediction</Text>
                {analysis.risk.limitations.map((limitation) => (
                  <Text key={limitation} style={styles.disclaimerText}>•  {limitation}</Text>
                ))}
                <Text style={styles.disclaimerText}>Location: {locationLabel ?? 'anonymized sample'}. No customer addresses or internal equipment IDs are displayed.</Text>
              </View>
            </>
          ) : null}
          <View style={styles.bottomSpace} />
        </ScrollView>
      ) : (
        <KeyboardAvoidingView
          style={styles.chatScreen}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            ref={chatScrollRef}
            style={styles.chatScroll}
            contentContainerStyle={styles.chatContent}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable accessibilityRole="button" onPress={() => setScreen('overview')} style={styles.backButton}>
              <Text style={styles.backText}>‹  BACK TO OUTLOOK</Text>
            </Pressable>
            <Text style={styles.eyebrow}>YOUR GUIDE</Text>
            <Text style={styles.heading}>Ask the assistant</Text>
            <Text style={styles.subtitle}>Answers use this scenario’s calculated results and assumptions.</Text>
            <View style={styles.quickPrompts}>
              {['Why is this risk elevated?', 'Compare repair scenarios with a graph', 'How can I prepare?'].map((prompt) => (
                <Pressable key={prompt} accessibilityRole="button" onPress={() => sendQuestion(prompt)} style={styles.quickPrompt}>
                  <Text style={styles.quickPromptText}>{prompt}</Text>
                </Pressable>
              ))}
            </View>
            {messages.map((message) => (
              <View
                key={message.id}
                style={[styles.message, message.role === 'user' ? styles.userMessage : styles.assistantMessage]}
              >
                <Text style={styles.messageRole}>{message.role === 'user' ? 'YOU' : 'CONCIERGE'}</Text>
                <Text style={styles.messageText}>{message.text}</Text>
                {message.visualization ? (
                  <View style={styles.chatChart}>
                    <Text style={styles.sectionLabel}>RESTORATION SCENARIO COMPARISON</Text>
                    <ScenarioChart points={message.visualization} />
                  </View>
                ) : null}
              </View>
            ))}
            {sending ? <ActivityIndicator style={styles.sending} color="#A51D32" /> : null}
          </ScrollView>
          <View style={styles.composerFooter}>
            <View style={styles.composer}>
              <TextInput
                accessibilityLabel="Ask a question"
                value={question}
                onChangeText={setQuestion}
                onSubmitEditing={() => sendQuestion()}
                placeholder="Ask about risk, timing, or prep…"
                placeholderTextColor="#8A98A2"
                returnKeyType="send"
                maxLength={500}
                style={styles.input}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send question"
                disabled={!question.trim() || sending}
                onPress={() => sendQuestion()}
                style={[styles.sendButton, (!question.trim() || sending) && styles.sendDisabled]}
              >
                <Text style={[styles.sendText, (!question.trim() || sending) && styles.sendTextDisabled]}>↑</Text>
              </Pressable>
            </View>
            <Text style={styles.chatPrivacy}>Please don’t enter names, addresses, or account information.</Text>
          </View>
        </KeyboardAvoidingView>
      )}

      {screen === 'overview' ? (
        <View style={styles.assistantFooter}>
          <BlurView intensity={75} tint="light" style={styles.glassNavigation}>
            <View pointerEvents="none" style={styles.glassHighlight} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show outage outlook"
              accessibilityState={{ selected: activeNavigation === 'outlook' }}
              onPress={() => navigateOverview('outlook')}
              style={[styles.navigationItem, activeNavigation === 'outlook' && styles.navigationItemSelected]}
            >
              <Text style={[styles.navigationIcon, activeNavigation === 'outlook' && styles.navigationTextSelected]}>⌂</Text>
              <Text style={[styles.navigationLabel, activeNavigation === 'outlook' && styles.navigationTextSelected]}>Outlook</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show current weather"
              accessibilityState={{ selected: activeNavigation === 'weather' }}
              onPress={() => navigateOverview('weather')}
              style={[styles.navigationItem, activeNavigation === 'weather' && styles.navigationItemSelected]}
            >
              <Text style={[styles.navigationIcon, activeNavigation === 'weather' && styles.navigationTextSelected]}>☼</Text>
              <Text style={[styles.navigationLabel, activeNavigation === 'weather' && styles.navigationTextSelected]}>Weather</Text>
            </Pressable>
          </BlurView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ask the assistant"
            style={styles.assistantButton}
            onPress={() => setScreen('assistant')}
          >
            <Text style={styles.assistantButtonIcon}>AI</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF8F8' },
  topBar: {
    backgroundColor: '#FCEAEC',
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: '#FCE4E6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandBolt: { color: '#A51D32', fontSize: 24, fontWeight: '700' },
  brandTextWrap: { marginLeft: 11, flex: 1 },
  brand: { color: '#55212A', fontSize: 11, letterSpacing: 1.5, fontWeight: '800' },
  brandSub: { color: '#8D5A62', fontSize: 12, marginTop: 3 },
  demoBadge: { borderRadius: 20, borderWidth: 1, borderColor: '#DEAAB1', paddingHorizontal: 9, paddingVertical: 5 },
  demoBadgeText: { color: '#8E3543', fontSize: 9, letterSpacing: 1, fontWeight: '700' },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 24, paddingBottom: 24 },
  chatContent: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 22, paddingBottom: 36 },
  chatScreen: { flex: 1 },
  chatScroll: { flex: 1 },
  eyebrow: { color: '#B42338', fontSize: 10, fontWeight: '800', letterSpacing: 1.7, marginBottom: 7 },
  heading: { color: '#18353E', fontSize: 28, letterSpacing: -0.7, fontWeight: '700' },
  subtitle: { color: '#61747A', fontSize: 14, lineHeight: 20, marginTop: 7, marginBottom: 18 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, marginBottom: 13, borderWidth: 1, borderColor: '#E7ECEA' },
  sectionLabel: { color: '#788B8E', fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  pillRow: { flexDirection: 'row', gap: 8, paddingTop: 10 },
  pill: { borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: '#F2F5F4', borderWidth: 1, borderColor: '#E5EBE9' },
  pillSelected: { backgroundColor: '#FCE8EA', borderColor: '#E39AA4' },
  pillText: { color: '#55696D', fontSize: 12, fontWeight: '600' },
  pillTextSelected: { color: '#951D30', fontWeight: '700' },
  spacedLabel: { marginTop: 18 },
  riskCard: { backgroundColor: '#FFF0F1', borderColor: '#F3D6DA' },
  cardTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  riskBadge: { backgroundColor: '#F8E1E4', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  riskBadgeHigh: { backgroundColor: '#F4C7CC' },
  riskBadgeText: { color: '#8E1D2D', fontSize: 9, letterSpacing: 0.8, fontWeight: '800' },
  riskScoreRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 8 },
  riskScore: { color: '#55212A', fontSize: 56, letterSpacing: -2, fontWeight: '700' },
  riskOutOf: { color: '#956B71', fontSize: 15, marginLeft: 7 },
  riskMeter: { height: 6, borderRadius: 6, backgroundColor: '#F1D9DC', overflow: 'hidden', marginTop: 1 },
  riskMeterFill: { height: '100%', backgroundColor: '#D98690', borderRadius: 6 },
  confidence: { color: '#984653', fontSize: 12, fontWeight: '700', marginTop: 13 },
  bodyText: { color: '#62777B', fontSize: 13, lineHeight: 19, marginTop: 12 },
  factorList: { borderTopWidth: 1, borderTopColor: '#EBD0D4', marginTop: 15, paddingTop: 8 },
  factorRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  factorName: { color: '#5D4146', fontSize: 12, flex: 1, paddingRight: 10 },
  factorScore: { color: '#A94251', fontSize: 12, fontWeight: '700' },
  cardTitle: { color: '#203B43', fontSize: 17, fontWeight: '700', marginTop: 5 },
  timerIcon: { color: '#B42338', fontSize: 24 },
  chartIcon: { color: '#B42338', fontSize: 22 },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 17, borderBottomWidth: 1, borderBottomColor: '#EDF0EF' },
  rangeHours: { color: '#163C45', fontSize: 30, fontWeight: '700', letterSpacing: -0.8 },
  rangeUnit: { color: '#75878A', fontSize: 11, marginTop: 2 },
  centralPill: { backgroundColor: '#FBEDEF', borderRadius: 13, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14 },
  centralCaption: { color: '#95636A', fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  centralValue: { color: '#951D30', fontSize: 16, fontWeight: '700', marginTop: 3 },
  controlRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 15 },
  controlLabel: { color: '#314E55', fontSize: 12, fontWeight: '700' },
  controlHint: { color: '#879699', fontSize: 10, marginTop: 3 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E4EBE8', borderRadius: 11, overflow: 'hidden' },
  stepButton: { width: 35, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FBEFF0' },
  stepText: { color: '#A51D32', fontSize: 20, fontWeight: '500', lineHeight: 23 },
  stepValue: { width: 32, textAlign: 'center', color: '#27444B', fontSize: 13, fontWeight: '700' },
  assumptionList: { marginTop: 8, gap: 6 },
  assumption: { color: '#829193', fontSize: 10, lineHeight: 15 },
  chart: { height: 154, flexDirection: 'row', gap: 13, paddingTop: 17, paddingBottom: 3 },
  chartColumn: { flex: 1, alignItems: 'center' },
  chartValue: { color: '#536D71', fontSize: 10, fontWeight: '700', height: 16 },
  chartTrack: { height: 104, width: '70%', justifyContent: 'flex-end', backgroundColor: '#F2F6F4', borderRadius: 8, overflow: 'hidden' },
  chartBar: { width: '100%', backgroundColor: '#E6A0A8', borderRadius: 7 },
  chartBarSelected: { backgroundColor: '#D98690' },
  chartLabel: { color: '#6F8385', fontSize: 9, marginTop: 7 },
  chartFootnote: { color: '#879598', fontSize: 10, lineHeight: 15, marginTop: 11 },
  weatherFreshness: { color: '#8E3543', backgroundColor: '#FCE8EA', overflow: 'hidden', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5, fontSize: 9, fontWeight: '800' },
  weatherCurrent: { flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 12 },
  weatherTemperature: { color: '#55212A', fontSize: 38, fontWeight: '700' },
  weatherCurrentDetails: { flex: 1, gap: 3 },
  weatherDescription: { color: '#354D52', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  weatherMeta: { color: '#718184', fontSize: 10, lineHeight: 15 },
  weatherForecast: { borderTopWidth: 1, borderTopColor: '#F0E3E4', marginTop: 12, paddingTop: 12 },
  weatherAlerts: { borderTopWidth: 1, borderTopColor: '#F0E3E4', marginTop: 12, paddingTop: 12, gap: 7 },
  weatherAlert: { backgroundColor: '#FFF3F4', borderLeftWidth: 3, borderLeftColor: '#B42338', padding: 9, gap: 3 },
  weatherUnavailable: { backgroundColor: '#FFF8F8' },
  alertCard: { backgroundColor: '#FFF3F4', borderColor: '#F0D0D4' },
  alertIcon: { color: '#B42338', fontSize: 23 },
  prepCard: { backgroundColor: '#FBF8F1', borderColor: '#EEE8D9' },
  prepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 14 },
  prepNumber: { color: '#A7804B', fontSize: 10, fontWeight: '800' },
  prepText: { color: '#4D5F5D', fontSize: 12, lineHeight: 18, flex: 1 },
  disclaimer: { backgroundColor: '#E8EEEC', borderRadius: 16, padding: 15, marginTop: 2 },
  disclaimerTitle: { color: '#38585A', fontSize: 11, fontWeight: '800', marginBottom: 6 },
  disclaimerText: { color: '#607477', fontSize: 10, lineHeight: 15, marginTop: 4 },
  errorCard: { backgroundColor: '#FFF4F0', borderColor: '#F2D4C9' },
  errorTitle: { color: '#8A3D2F', fontSize: 14, fontWeight: '700' },
  errorText: { color: '#7E5047', fontSize: 12, lineHeight: 18, marginTop: 6 },
  helperText: { color: '#718184', fontSize: 11, lineHeight: 16, marginTop: 8 },
  loadingCard: { alignItems: 'center', paddingVertical: 22 },
  bottomSpace: { height: 12 },
  assistantFooter: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  glassNavigation: {
    height: 62,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    borderRadius: 23,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.92)',
    backgroundColor: 'rgba(255, 255, 255, 0.56)',
    overflow: 'hidden',
    shadowColor: '#6E5053',
    shadowOpacity: 0.11,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  glassHighlight: {
    position: 'absolute',
    top: 0,
    left: 18,
    right: 18,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
  },
  navigationItem: {
    minWidth: 96,
    height: 46,
    paddingHorizontal: 12,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  navigationItemSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
  },
  navigationIcon: { color: '#758184', fontSize: 19, lineHeight: 23 },
  navigationLabel: { color: '#68777A', fontSize: 11, fontWeight: '700' },
  navigationTextSelected: { color: '#8E2433' },
  assistantButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#B42338',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#691322',
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  assistantButtonIcon: { color: '#FFFFFF', fontSize: 15, letterSpacing: 0.6, fontWeight: '800' },
  backButton: { alignSelf: 'flex-start', paddingVertical: 9, paddingHorizontal: 11, marginLeft: -8, marginBottom: 18 },
  backText: { color: '#A51D32', fontSize: 10, letterSpacing: 1, fontWeight: '800' },
  quickPrompts: { gap: 8, marginBottom: 19 },
  quickPrompt: { borderWidth: 1, borderColor: '#EDD0D4', backgroundColor: '#FFFFFF', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 13, alignSelf: 'flex-start' },
  quickPromptText: { color: '#951D30', fontSize: 12, fontWeight: '600' },
  message: { padding: 14, borderRadius: 17, marginBottom: 10, maxWidth: '92%' },
  userMessage: { alignSelf: 'flex-end', backgroundColor: '#FBE5E8', borderBottomRightRadius: 5 },
  assistantMessage: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7ECEA', borderBottomLeftRadius: 5 },
  messageRole: { color: '#738581', fontSize: 8, fontWeight: '800', letterSpacing: 1.2, marginBottom: 6 },
  messageText: { color: '#354D52', fontSize: 13, lineHeight: 19 },
  chatChart: { marginTop: 14, borderTopWidth: 1, borderTopColor: '#E7ECEA', paddingTop: 12 },
  sending: { alignSelf: 'flex-start', marginVertical: 12 },
  composerFooter: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 8, paddingBottom: 8, backgroundColor: '#FFF8F8', borderTopWidth: 1, borderTopColor: '#F1E3E4' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 5, borderRadius: 19, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EADBDD' },
  input: { flex: 1, backgroundColor: 'transparent', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, color: '#55212A', fontSize: 13 },
  sendButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#B42338', borderWidth: 1, borderColor: '#A51D32' },
  sendDisabled: { backgroundColor: '#F8E8EA', borderColor: '#EFD5D8' },
  sendText: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', lineHeight: 25 },
  sendTextDisabled: { color: '#B27A81' },
  chatPrivacy: { color: '#849292', fontSize: 9, lineHeight: 14, marginTop: 6, textAlign: 'center' },
});
