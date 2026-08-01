import { PreferencesSnapshot, SuggestedQuestion } from "../contracts/memory";

export class PreferenceStore {
  private state: PreferencesSnapshot;

  constructor() {
    this.state = this.defaultState();
  }

  private defaultState(): PreferencesSnapshot {
    return {
      frequentTopics: {},
      preferredPeriod: null,
      preferredLanguage: "english",
      ignoredRecommendationTypes: [],
      topicFrequency7d: {},
      suggestedQuestions: [],
      version: 1,
      lastModified: new Date().toISOString(),
      totalInteractions: 0,
    };
  }

  // ─── Getters ───

  get(): PreferencesSnapshot {
    return { ...this.state, suggestedQuestions: [...this.state.suggestedQuestions] };
  }

  get frequentTopics(): Record<string, number> {
    return { ...this.state.frequentTopics };
  }

  get preferredPeriod(): "today" | "week" | "month" | null {
    return this.state.preferredPeriod;
  }

  get preferredLanguage(): "english" | "urdu" | "roman_urdu" {
    return this.state.preferredLanguage;
  }

  get ignoredRecommendationTypes(): string[] {
    return [...this.state.ignoredRecommendationTypes];
  }

  get suggestedQuestions(): SuggestedQuestion[] {
    return [...this.state.suggestedQuestions];
  }

  get totalInteractions(): number {
    return this.state.totalInteractions;
  }

  // ─── Topic Tracking ───

  incrementTopic(topic: string): void {
    this.state.frequentTopics[topic] = (this.state.frequentTopics[topic] || 0) + 1;
    this.state.topicFrequency7d[topic] = (this.state.topicFrequency7d[topic] || 0) + 1;
    this.state.totalInteractions++;
    this.state.lastModified = new Date().toISOString();
  }

  // ─── Period Learning ───

  private periodCounts = { today: 0, week: 0, month: 0 };

  recordPeriodHint(period: "today" | "week" | "month"): void {
    this.periodCounts[period]++;
    if (this.periodCounts[period] >= 3) {
      this.state.preferredPeriod = period;
      this.state.lastModified = new Date().toISOString();
    }
  }

  // ─── Language Learning ───

  private languageStreak: Record<string, number> = { english: 0, urdu: 0, roman_urdu: 0 };

  recordLanguage(language: "english" | "urdu" | "roman_urdu"): void {
    for (const lang of Object.keys(this.languageStreak) as Array<"english" | "urdu" | "roman_urdu">) {
      this.languageStreak[lang] = lang === language ? this.languageStreak[lang] + 1 : 0;
    }
    if (this.languageStreak[language] >= 3) {
      this.state.preferredLanguage = language;
      this.state.lastModified = new Date().toISOString();
    }
  }

  // ─── Recommendation Dismissal ───

  addIgnoredType(type: string): void {
    if (!this.state.ignoredRecommendationTypes.includes(type)) {
      this.state.ignoredRecommendationTypes.push(type);
      this.state.lastModified = new Date().toISOString();
    }
  }

  removeIgnoredType(type: string): void {
    this.state.ignoredRecommendationTypes = this.state.ignoredRecommendationTypes.filter((t) => t !== type);
    this.state.lastModified = new Date().toISOString();
  }

  // ─── Suggested Questions ───

  updateSuggestedQuestions(questions: SuggestedQuestion[]): void {
    this.state.suggestedQuestions = questions;
    this.state.lastModified = new Date().toISOString();
  }

  // ─── Explicit Preferences ───

  setLanguage(language: "english" | "urdu" | "roman_urdu"): void {
    this.state.preferredLanguage = language;
    this.state.lastModified = new Date().toISOString();
  }

  setPeriod(period: "today" | "week" | "month" | null): void {
    this.state.preferredPeriod = period;
    this.state.lastModified = new Date().toISOString();
  }

  // ─── Reset ───

  reset(): void {
    this.state = this.defaultState();
    this.periodCounts = { today: 0, week: 0, month: 0 };
    this.languageStreak = { english: 0, urdu: 0, roman_urdu: 0 };
  }

  // ─── Serialization ───

  serialize(): PreferencesSnapshot {
    return this.get();
  }

  load(snapshot: PreferencesSnapshot): void {
    this.state = {
      ...snapshot,
      suggestedQuestions: [...snapshot.suggestedQuestions],
    };
  }
}
