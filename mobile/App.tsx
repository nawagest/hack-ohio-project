import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

type StormSeverity = 'light' | 'moderate' | 'severe';
type DemoLocation = { id: string; label: string; description: string };
type ChartPoint = { repair_count: number; hours: number };
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
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
        <ScrollView contentContainerStyle={styles.chatContent} keyboardShouldPersistTaps="handled">
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
          {sending ? <ActivityIndicator style={styles.sending} color="#148477" /> : null}
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
              <Text style={styles.sendText}>↑</Text>
            </Pressable>
          </View>
          <Text style={styles.chatPrivacy}>Please don’t enter names, addresses, or account information.</Text>
        </ScrollView>
      )}

      {screen === 'overview' ? (
        <Pressable accessibilityRole="button" style={styles.assistantButton} onPress={() => setScreen('assistant')}>
          <Text style={styles.assistantButtonIcon}>✳</Text>
          <Text style={styles.assistantButtonText}>Ask the assistant</Text>
          <Text style={styles.assistantButtonArrow}>→</Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3F6F5' },
  topBar: {
    backgroundColor: '#102C37',
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
    backgroundColor: '#D8F0E7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandBolt: { color: '#145E56', fontSize: 24, fontWeight: '700' },
  brandTextWrap: { marginLeft: 11, flex: 1 },
  brand: { color: '#F5FBF9', fontSize: 11, letterSpacing: 1.5, fontWeight: '800' },
  brandSub: { color: '#B6C8CB', fontSize: 12, marginTop: 3 },
  demoBadge: { borderRadius: 20, borderWidth: 1, borderColor: '#54747A', paddingHorizontal: 9, paddingVertical: 5 },
  demoBadgeText: { color: '#D2E4E0', fontSize: 9, letterSpacing: 1, fontWeight: '700' },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 24, paddingBottom: 24 },
  chatContent: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 22, paddingBottom: 36 },
  eyebrow: { color: '#398377', fontSize: 10, fontWeight: '800', letterSpacing: 1.7, marginBottom: 7 },
  heading: { color: '#18353E', fontSize: 28, letterSpacing: -0.7, fontWeight: '700' },
  subtitle: { color: '#61747A', fontSize: 14, lineHeight: 20, marginTop: 7, marginBottom: 18 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, marginBottom: 13, borderWidth: 1, borderColor: '#E7ECEA' },
  sectionLabel: { color: '#788B8E', fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  pillRow: { flexDirection: 'row', gap: 8, paddingTop: 10 },
  pill: { borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: '#F2F5F4', borderWidth: 1, borderColor: '#E5EBE9' },
  pillSelected: { backgroundColor: '#E3F3ED', borderColor: '#6EB7A2' },
  pillText: { color: '#55696D', fontSize: 12, fontWeight: '600' },
  pillTextSelected: { color: '#155C50', fontWeight: '700' },
  spacedLabel: { marginTop: 18 },
  riskCard: { backgroundColor: '#163C45', borderColor: '#163C45' },
  cardTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  riskBadge: { backgroundColor: '#D7EFE5', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  riskBadgeHigh: { backgroundColor: '#F7DCCF' },
  riskBadgeText: { color: '#1E6757', fontSize: 9, letterSpacing: 0.8, fontWeight: '800' },
  riskScoreRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 8 },
  riskScore: { color: '#F7FBF8', fontSize: 56, letterSpacing: -2, fontWeight: '700' },
  riskOutOf: { color: '#ADC2C3', fontSize: 15, marginLeft: 7 },
  riskMeter: { height: 6, borderRadius: 6, backgroundColor: '#3A5A61', overflow: 'hidden', marginTop: 1 },
  riskMeterFill: { height: '100%', backgroundColor: '#8AD1AE', borderRadius: 6 },
  confidence: { color: '#C6E5D8', fontSize: 12, fontWeight: '700', marginTop: 13 },
  bodyText: { color: '#62777B', fontSize: 13, lineHeight: 19, marginTop: 12 },
  factorList: { borderTopWidth: 1, borderTopColor: '#3B5A60', marginTop: 15, paddingTop: 8 },
  factorRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  factorName: { color: '#E3EEEB', fontSize: 12, flex: 1, paddingRight: 10 },
  factorScore: { color: '#A9D9C2', fontSize: 12, fontWeight: '700' },
  cardTitle: { color: '#203B43', fontSize: 17, fontWeight: '700', marginTop: 5 },
  timerIcon: { color: '#5A9B8C', fontSize: 24 },
  chartIcon: { color: '#598F82', fontSize: 22 },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 17, borderBottomWidth: 1, borderBottomColor: '#EDF0EF' },
  rangeHours: { color: '#163C45', fontSize: 30, fontWeight: '700', letterSpacing: -0.8 },
  rangeUnit: { color: '#75878A', fontSize: 11, marginTop: 2 },
  centralPill: { backgroundColor: '#EFF7F3', borderRadius: 13, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14 },
  centralCaption: { color: '#748C85', fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  centralValue: { color: '#176756', fontSize: 16, fontWeight: '700', marginTop: 3 },
  controlRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 15 },
  controlLabel: { color: '#314E55', fontSize: 12, fontWeight: '700' },
  controlHint: { color: '#879699', fontSize: 10, marginTop: 3 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E4EBE8', borderRadius: 11, overflow: 'hidden' },
  stepButton: { width: 35, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F7F5' },
  stepText: { color: '#236A5B', fontSize: 20, fontWeight: '500', lineHeight: 23 },
  stepValue: { width: 32, textAlign: 'center', color: '#27444B', fontSize: 13, fontWeight: '700' },
  assumptionList: { marginTop: 8, gap: 6 },
  assumption: { color: '#829193', fontSize: 10, lineHeight: 15 },
  chart: { height: 154, flexDirection: 'row', gap: 13, paddingTop: 17, paddingBottom: 3 },
  chartColumn: { flex: 1, alignItems: 'center' },
  chartValue: { color: '#536D71', fontSize: 10, fontWeight: '700', height: 16 },
  chartTrack: { height: 104, width: '70%', justifyContent: 'flex-end', backgroundColor: '#F2F6F4', borderRadius: 8, overflow: 'hidden' },
  chartBar: { width: '100%', backgroundColor: '#89BFA9', borderRadius: 7 },
  chartBarSelected: { backgroundColor: '#176F5E' },
  chartLabel: { color: '#6F8385', fontSize: 9, marginTop: 7 },
  chartFootnote: { color: '#879598', fontSize: 10, lineHeight: 15, marginTop: 11 },
  alertCard: { backgroundColor: '#F0F8F3', borderColor: '#CFE9DA' },
  alertIcon: { color: '#41866F', fontSize: 23 },
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
  bottomSpace: { height: 80 },
  assistantButton: {
    position: 'absolute',
    left: 18,
    right: 18,
    maxWidth: 524,
    alignSelf: 'center',
    bottom: 16,
    borderRadius: 16,
    backgroundColor: '#14584F',
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    shadowColor: '#0B332D',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  assistantButtonIcon: { color: '#9DE2C0', fontSize: 17 },
  assistantButtonText: { color: '#FFFFFF', flex: 1, marginLeft: 10, fontSize: 13, fontWeight: '700' },
  assistantButtonArrow: { color: '#D0EFE0', fontSize: 19 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 9, paddingHorizontal: 11, marginLeft: -8, marginBottom: 18 },
  backText: { color: '#277165', fontSize: 10, letterSpacing: 1, fontWeight: '800' },
  quickPrompts: { gap: 8, marginBottom: 19 },
  quickPrompt: { borderWidth: 1, borderColor: '#D8E6E0', backgroundColor: '#FFFFFF', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 13, alignSelf: 'flex-start' },
  quickPromptText: { color: '#23685B', fontSize: 12, fontWeight: '600' },
  message: { padding: 14, borderRadius: 17, marginBottom: 10, maxWidth: '92%' },
  userMessage: { alignSelf: 'flex-end', backgroundColor: '#DDF0E7', borderBottomRightRadius: 5 },
  assistantMessage: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7ECEA', borderBottomLeftRadius: 5 },
  messageRole: { color: '#738581', fontSize: 8, fontWeight: '800', letterSpacing: 1.2, marginBottom: 6 },
  messageText: { color: '#354D52', fontSize: 13, lineHeight: 19 },
  chatChart: { marginTop: 14, borderTopWidth: 1, borderTopColor: '#E7ECEA', paddingTop: 12 },
  sending: { alignSelf: 'flex-start', marginVertical: 12 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 8 },
  input: { flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DFE8E4', borderRadius: 15, paddingHorizontal: 14, paddingVertical: 12, color: '#27434A', fontSize: 13 },
  sendButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#155D52' },
  sendDisabled: { backgroundColor: '#9DADA8' },
  sendText: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', lineHeight: 25 },
  chatPrivacy: { color: '#849292', fontSize: 9, lineHeight: 14, marginTop: 9, textAlign: 'center' },
});
