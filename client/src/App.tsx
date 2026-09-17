import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { login, postDoubtQuestion, postGraphicalQuestion, postQuestion, postScore, signup, getUserHistory, getHistoryDetail } from "./services/api";
import { uploadQuestionImage } from "./services/supabase";
import type { Coordinate, LearnAgainResponse, Question, QuestionResponse, User, HistoryEntry, HistoryDetail } from "./types";
import MathText from "./components/MathText";
import VoiceTutor from "./components/VoiceTutor";
import { useVoiceTutor } from "./hooks/useVoiceTutor";
import "./App.css";

type Page = "landing" | "login" | "signup" | "app";
type Stage = "home" | "loading" | "quiz" | "result" | "learnAgain" | "original" | "evaluation" | "history_view";
type Mode = "standard" | "graphical";

type StoredSession = {
  id: number | string;
  username: string;
};

const SESSION_KEY = "nova_ai_session";
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const DESKTOP_SIDEBAR_QUERY = "(min-width: 701px)";

const quotes = [
  "Every expert was once a beginner.",
  "The important thing is not to stop questioning.",
  "Learning never exhausts the mind.",
  "Small steps lead to big discoveries.",
  "Curiosity is the beginning of understanding.",
];

// Floating symbols for decorative background
const MATH_SYMBOLS = [
  // Mathematics
  { char: "∑", size: 110, left: 5,  delay: 0,    duration: 18 },
  { char: "∫", size: 130, left: 15, delay: 3,    duration: 22 },
  { char: "π", size: 95,  left: 28, delay: 6,    duration: 16 },
  { char: "√", size: 105, left: 42, delay: 1.5,  duration: 20 },

  // Science
  { char: "⚛", size: 100, left: 58, delay: 9,    duration: 25 },
  { char: "H₂O", size: 82, left: 72, delay: 4,    duration: 19 },
  { char: "DNA", size: 78, left: 85, delay: 7,    duration: 21 },
  { char: "CO₂", size: 82, left: 93, delay: 2,    duration: 17 },

  // Computer Science / AI
  { char: "</>", size: 82, left: 35, delay: 11,   duration: 23 },
  { char: "0101", size: 72, left: 65, delay: 5,    duration: 15 },
  { char: "AI", size: 88, left: 50, delay: 13,   duration: 24 },
  { char: "{ }", size: 82, left: 78, delay: 8,    duration: 20 },
];

function MathBackground() {
  return (
    <div className="math-bg" aria-hidden="true">
      {MATH_SYMBOLS.map((sym, i) => (
        <span
          key={i}
          className="math-symbol"
          style={{
            left: `${sym.left}%`,
            bottom: "-80px",
            fontSize: `${sym.size}px`,
            animationDuration: `${sym.duration}s`,
            animationDelay: `${sym.delay}s`,
          }}
        >
          {sym.char}
        </span>
      ))}
    </div>
  );
}

function readStoredSession(): User | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("id" in parsed) ||
      !("username" in parsed) ||
      (typeof parsed.id !== "string" && typeof parsed.id !== "number") ||
      typeof parsed.username !== "string" ||
      !parsed.username.trim()
    ) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed as StoredSession;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function isQuestion(value: unknown): value is Question {
  if (typeof value !== "object" || value === null) return false;
  if (!("question" in value) || !("options" in value) || !("hint" in value) || !("correct_option" in value)) {
    return false;
  }

  const question = value.question;
  const options = value.options;
  const hint = value.hint;
  const correctOption = value.correct_option;
  const solution = "solution" in value ? value.solution : undefined;
  const coordinates = "coordinates" in value ? value.coordinates : undefined;

  return (
    typeof question === "string" &&
    question.trim().length > 0 &&
    Array.isArray(options) &&
    options.length === 4 &&
    options.every((option) => typeof option === "string") &&
    typeof hint === "string" &&
    typeof correctOption === "number" &&
    Number.isInteger(correctOption) &&
    correctOption >= 1 &&
    correctOption <= 4 &&
    (solution === undefined || typeof solution === "string") &&
    (coordinates === undefined || (
      Array.isArray(coordinates) &&
      coordinates.length <= 4 &&
      coordinates.every((point) => (
        Array.isArray(point) && point.length === 2 &&
        point.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
      ))
    ))
  );
}

function validateQuestionResponse(value: unknown): QuestionResponse | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("is_relevant" in value) || typeof value.is_relevant !== "boolean") return null;
  if (!("error_message" in value) || typeof value.error_message !== "string") return null;

  if (!value.is_relevant) {
    return value as QuestionResponse;
  }

  if (
    !("ai_questions" in value) ||
    !Array.isArray(value.ai_questions) ||
    value.ai_questions.length === 0 ||
    !value.ai_questions.every(isQuestion) ||
    !("user_question" in value) ||
    !isQuestion(value.user_question)
  ) {
    return null;
  }

  return value as QuestionResponse;
}

function validateLearnAgainResponse(value: unknown): LearnAgainResponse | null {
  if (typeof value !== "object" || value === null) return null;
  if (
    !("ai_questions" in value) ||
    !Array.isArray(value.ai_questions) ||
    value.ai_questions.length === 0 ||
    !value.ai_questions.every(isQuestion)
  ) {
    return null;
  }
  if (!("user_question" in value) || !isQuestion(value.user_question)) return null;
  return value as LearnAgainResponse;
}

function App() {
  const [page, setPage] = useState<Page>(() => (readStoredSession() ? "app" : "landing"));
  const [user, setUser] = useState<User | null>(() => readStoredSession());

  function authenticate(userData: User) {
    const safeUser = { id: userData.id, username: userData.username.trim() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(safeUser));
    setUser(safeUser);
    setPage("app");
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
    setPage("landing");
  }

  if (page === "landing") {
    return <Landing onLogin={() => setPage("login")} onSignup={() => setPage("signup")} />;
  }

  if (page === "login" || page === "signup") {
    return (
      <Auth
        mode={page}
        onBack={() => setPage("landing")}
        onSwitch={() => setPage(page === "login" ? "signup" : "login")}
        onAuthenticated={authenticate}
      />
    );
  }

  if (!user) {
    return <Landing onLogin={() => setPage("login")} onSignup={() => setPage("signup")} />;
  }

  return <NovaAI user={user} onLogout={logout} />;
}

function Landing({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  return (
    <motion.main
      className="landing"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.65 }}
    >
      <MathBackground />
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <motion.div
        className="landing-content"
        initial={{ opacity: 0, y: 45, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 90, damping: 15 }}
      >
        <motion.div
          className="logo"
          initial={{ y: -18, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15 }}
        >
          <span className="logo-icon">∑</span>
          Stepwise Prism AI
        </motion.div>

        <motion.p
          className="landing-formula"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          f(x) = ∫₀ˣ g(t) dt &nbsp;·&nbsp; lim(n→∞) (1 + 1/n)ⁿ = e &nbsp;·&nbsp; ∇²φ = ρ/ε₀
        </motion.p>

        <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          Learn by <span>understanding.</span>
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
          Ask any question, practice the concept through AI-generated scaffolding, and discover whether you truly understood it.
        </motion.p>
        <motion.div className="landing-actions" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <motion.button whileHover={{ scale: 1.045, y: -3 }} whileTap={{ scale: 0.97 }} className="primary" onClick={onSignup}>Get started</motion.button>
          <motion.button whileHover={{ scale: 1.045, y: -3 }} whileTap={{ scale: 0.97 }} className="secondary" onClick={onLogin}>Log in</motion.button>
        </motion.div>

        <motion.div
          className="landing-pills"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65 }}
        >
          <span className="landing-pill"><span>∑</span>Scaffolded MCQs</span>
          <span className="landing-pill"><span>∫</span>Step-by-step hints</span>
          <span className="landing-pill"><span>π</span>Graph mode</span>
          <span className="landing-pill"><span>Δ</span>Learn Again</span>
          <span className="landing-pill"><span>√</span>AI-powered feedback</span>
        </motion.div>
      </motion.div>
    </motion.main>
  );
}

function Auth({
  mode,
  onBack,
  onSwitch,
  onAuthenticated,
}: {
  mode: "login" | "signup";
  onBack: () => void;
  onSwitch: () => void;
  onAuthenticated: (user: User) => void;
}) {
  const isLogin = mode === "login";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [standard, setStandard] = useState<number | "">("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const cleanUsername = username.trim();
    if (!cleanUsername || !password) {
      setError("Username and password are required.");
      return;
    }

    if (!isLogin && (standard === "" || standard < 6 || standard > 12)) {
      setError("Please select your class (6 – 12).");
      return;
    }

    setLoading(true);
    try {
      const response = isLogin
        ? await login(cleanUsername, password)
        : await signup(cleanUsername, password, standard as number);
      if (!response.data || typeof response.data.username !== "string") {
        throw new Error("Stepwise Prism AI returned an invalid account response.");
      }
      onAuthenticated(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.main className="auth-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.45 }}>
      <MathBackground />
      <motion.form className="auth-card" onSubmit={submit} initial={{ opacity: 0, y: 35, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 100, damping: 16 }}>
        <motion.button type="button" className="back" onClick={onBack} whileHover={{ x: -4 }} whileTap={{ scale: 0.96 }}>← Back</motion.button>
        <motion.div className="logo" initial={{ scale: 0.7, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 160 }}>
          <span className="logo-icon">∑</span>
          Stepwise Prism AI
        </motion.div>
        <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>{isLogin ? "Welcome back" : "Create your account"}</motion.h1>
        <p className="muted">{isLogin ? "Log in to continue learning." : "Start your learning journey."}</p>

        <label htmlFor="username">Username
          <input
            id="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Enter username"
            autoComplete="username"
            disabled={loading}
          />
        </label>

        <label htmlFor="password">Password
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            disabled={loading}
          />
        </label>

        {!isLogin && (
          <label htmlFor="standard">Class / Standard
            <select
              id="standard"
              value={standard}
              onChange={(event) => setStandard(event.target.value === "" ? "" : Number(event.target.value))}
              disabled={loading}
              aria-required="true"
            >
              <option value="">Select your class</option>
              {[6, 7, 8, 9, 10, 11, 12].map((cls) => (
                <option key={cls} value={cls}>Class {cls}</option>
              ))}
            </select>
          </label>
        )}

        <AnimatePresence mode="wait">
          {error && <motion.div className="error" role="alert" initial={{ opacity: 0, height: 0, y: -8 }} animate={{ opacity: 1, height: "auto", y: 0 }} exit={{ opacity: 0, height: 0, y: -8 }}> {error}</motion.div>}
        </AnimatePresence>
        <motion.button whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.98 }} className="primary full" disabled={loading}>
          {loading ? (isLogin ? "Signing in..." : "Creating account...") : isLogin ? "Log in" : "Create account"}
        </motion.button>
        <motion.button whileHover={{ y: -1 }} type="button" className="switch-auth" onClick={onSwitch} disabled={loading}>
          {isLogin ? "Don't have an account? Sign up" : "Already have an account? Log in"}
        </motion.button>
      </motion.form>
    </motion.main>
  );
}

function NovaAI({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [sidebarOpen, setSidebarOpen] = useState(() => (
    typeof window === "undefined" ? true : window.matchMedia(DESKTOP_SIDEBAR_QUERY).matches
  ));
  const [stage, setStage] = useState<Stage>("home");
  const [quote, setQuote] = useState(() => quotes[Math.floor(Math.random() * quotes.length)]);
  const [questionText, setQuestionText] = useState("");
  const [mode, setMode] = useState<Mode>("standard");
  const [coordinates, setCoordinates] = useState<Coordinate[]>([]);
  const [image, setImage] = useState<File | null>(null);
  const [imagePath, setImagePath] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Understanding your question...");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [originalQuestion, setOriginalQuestion] = useState<Question | null>(null);
  const [sessionResponse, setSessionResponse] = useState<QuestionResponse | null>(null);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [showHint, setShowHint] = useState(false);
  const [error, setError] = useState("");
  const [score, setScore] = useState(0);
  const [finalAnswer, setFinalAnswer] = useState<number | null>(null);
  const [learnAnswers, setLearnAnswers] = useState<Record<number, number>>({});
  const [learnCurrent, setLearnCurrent] = useState(0);
  const [learnQuestions, setLearnQuestions] = useState<Question[]>([]);
  const [learnError, setLearnError] = useState("");
  const [learnLoadingIndex, setLearnLoadingIndex] = useState<number | null>(null);
  const [learnScore, setLearnScore] = useState(0);
  const [showLearnResult, setShowLearnResult] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [currentHistoryDetail, setCurrentHistoryDetail] = useState<HistoryDetail | null>(null);

  // Advanced Voice Mode modal state
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);

  const { status, isRecording, userBars, aiLevel, isMuted, startSession, stopSession, toggleMute } = useVoiceTutor();

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_SIDEBAR_QUERY);
    const syncSidebar = (event: MediaQueryListEvent) => setSidebarOpen(event.matches);

    mediaQuery.addEventListener("change", syncSidebar);
    return () => mediaQuery.removeEventListener("change", syncSidebar);
  }, []);

  useEffect(() => {
    async function loadHistory() {
      try {
        const response = await getUserHistory(user.username);
        setHistory(response.data);
      } catch (err) {
        console.error("Failed to load history:", err);
      }
    }
    void loadHistory();
  }, [user.username]);

  function removeImage() {
    setImage(null);
    setImagePath("");
    setImagePreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
  }

  function newChat() {
    removeImage();
    setQuestionText("");
    setMode("standard");
    setCoordinates([]);
    setQuestions([]);
    setOriginalQuestion(null);
    setSessionResponse(null);
    setCurrent(0);
    setAnswers({});
    setShowHint(false);
    setScore(0);
    setFinalAnswer(null);
    setError("");
    setLearnError("");
    setLearnQuestions([]);
    setLearnAnswers({});
    setLearnCurrent(0);
    setLearnLoadingIndex(null);
    setLearnScore(0);
    setShowLearnResult(false);
    setQuote(quotes[Math.floor(Math.random() * quotes.length)]);
    setStage("home");
    window.location.reload();
  }

  async function viewHistoryItem(historyId: number) {
    try {
      setStage("loading");
      setLoadingMessage("Loading your history...");
      
      const response = await getHistoryDetail(user.username, historyId);
      setCurrentHistoryDetail(response.data);
      setStage("history_view");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history detail");
      setStage("home");
    }
  }

  async function selectImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ];
    const fileExtension = file.name.split(".").pop()?.toLowerCase();
    const allowedExtensions = ["jpg", "jpeg", "png", "webp", "heic", "heif"];
    if (
      (file.type && !allowedTypes.includes(file.type)) ||
      (!file.type && !fileExtension) ||
      (fileExtension && !allowedExtensions.includes(fileExtension))
    ) {
      setError("Please choose a JPG, PNG, WEBP, HEIC or HEIF image.");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setError("Image is too large. Please choose an image up to 10 MB.");
      return;
    }

    setError("");
    removeImage();
    setImage(file);
    setImagePreview(URL.createObjectURL(file));

    setImageUploading(true);
    try {
      const uploadedPath = await uploadQuestionImage(file);
      setImagePath(uploadedPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image upload failed. Please try again.");
      removeImage();
    } finally {
      setImageUploading(false);
    }
  }

  async function submitQuestion() {
    const cleanQuestion = questionText.trim();
    if (!cleanQuestion && !image) {
      setError("Enter a question or upload an image.");
      return;
    }

    if (imageUploading || stage === "loading") return;

    setError("");
    setStage("loading");

    try {
      setLoadingMessage(
        mode === "graphical" ? "Reading your graph..." :
        "Understanding your question..."
      );
      await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
      setLoadingMessage("Generating a personalized practice session...");

      const rawResponse = mode === "graphical"
        ? await postGraphicalQuestion(user.username, cleanQuestion, coordinates)
        : await postQuestion(user.username, cleanQuestion, imagePath);
      const response = validateQuestionResponse(rawResponse);

      if (!response) {
        throw new Error("Something went wrong while preparing your practice session. Please try again.");
      }

      if (response.is_relevant !== true) {
        setError(response.error_message || "This question could not be processed.");
        setStage("home");
        return;
      }

      setSessionResponse(response);
      setQuestions(response.ai_questions);
      setOriginalQuestion(response.user_question);
      setCurrent(0);
      setAnswers({});
      setShowHint(false);
      setStage("quiz");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to connect to Stepwise Prism AI. Please try again.");
      setStage("home");
    } finally {
      setImageUploading(false);
    }
  }

  function chooseAnswer(option: number) {
    setAnswers((previous) => ({ ...previous, [current]: option }));
  }

  function finishPractice() {
    const finalScore = questions.reduce(
      (total, item, index) => total + (answers[index] === item.correct_option ? 1 : 0),
      0,
    );
    const wrongAnsweredQuestions = questions
      .filter((item, index) => answers[index] !== item.correct_option)
      .map((item) => item.question)
      .join(", ");

    setScore(finalScore);
    setShowHint(false);
    setStage("result");

    if (sessionResponse) {
      void postScore(
        user.username,
        JSON.stringify(sessionResponse),
        wrongAnsweredQuestions,
        `${finalScore}/${questions.length}`,
      ).catch(() => {});
    }
  }

  function nextQuestion() {
    if (answers[current] == null) return;

    if (current < questions.length - 1) {
      setCurrent((value) => value + 1);
      setShowHint(false);
      return;
    }

    finishPractice();
  }

  function previousQuestion() {
    if (current === 0) return;
    setCurrent((value) => value - 1);
    setShowHint(false);
  }

  function startOriginal() {
    setFinalAnswer(null);
    setShowHint(false);
    setStage("original");
  }

  function submitOriginal() {
    if (!originalQuestion || finalAnswer == null) return;
    setStage("evaluation");
  }

  async function learnAgain(question: Question, reviewIndex: number) {
    if (!sessionResponse || learnLoadingIndex !== null) return;

    setLearnError("");
    setLearnLoadingIndex(reviewIndex);
    setLoadingMessage("Preparing easier practice...");
    setStage("loading");

    try {
      const rawResponse = await postDoubtQuestion(
        user.username,
        question.question,
        JSON.stringify(sessionResponse),
      );
      const response = validateLearnAgainResponse(rawResponse);
      if (!response) {
        throw new Error("Something went wrong while preparing the new practice session. Please try again.");
      }

      setLearnQuestions(response.ai_questions);
      setLearnAnswers({});
      setLearnCurrent(0);
      setLearnScore(0);
      setShowLearnResult(false);
      setShowHint(false);
      setLearnError("");
      setStage("learnAgain");
    } catch (err) {
      setLearnError(err instanceof Error ? err.message : "Unable to prepare easier practice. Please try again.");
      setStage("result");
    } finally {
      setLearnLoadingIndex(null);
    }
  }

  function chooseLearnAnswer(option: number) {
    setLearnAnswers((previous) => ({ ...previous, [learnCurrent]: option }));
  }

  function nextLearnQuestion() {
    if (learnAnswers[learnCurrent] == null) return;
    if (learnCurrent < learnQuestions.length - 1) {
      setLearnCurrent((value) => value + 1);
      setShowHint(false);
      return;
    }
    const finalLearnScore = learnQuestions.reduce(
      (total, item, index) => total + (learnAnswers[index] === item.correct_option ? 1 : 0),
      0,
    );
    setLearnScore(finalLearnScore);
    setShowLearnResult(true);
    setShowHint(false);
    setStage("result");
  }

  const progress = questions.length ? ((current + 1) / questions.length) * 100 : 0;
  const learnProgress = learnQuestions.length ? ((learnCurrent + 1) / learnQuestions.length) * 100 : 0;

  const review = useMemo(
    () => questions.map((question, index) => ({
      question,
      index,
      selected: answers[index] ?? null,
      correct: answers[index] === question.correct_option,
    })),
    [answers, questions],
  );

  const learnReview = useMemo(
    () => learnQuestions.map((question, index) => ({
      question,
      index,
      selected: learnAnswers[index] ?? null,
      correct: learnAnswers[index] === question.correct_option,
    })),
    [learnAnswers, learnQuestions],
  );

  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
      <motion.div className="ambient ambient-app-one" animate={{ x: [0, 35, 0], y: [0, -20, 0] }} transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }} />
      <motion.div className="ambient ambient-app-two" animate={{ x: [0, -28, 0], y: [0, 25, 0] }} transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }} />
      <MathBackground />

      {/* Voice Tutor ChatGPT-like overlay */}
      <VoiceTutor 
        isOpen={voiceModalOpen} 
        onClose={() => {
          setVoiceModalOpen(false);
          stopSession(); // Stops audio when closed
        }}
        status={status}
        isRecording={isRecording}
        userBars={userBars}
        aiLevel={aiLevel}
        isMuted={isMuted}
        onToggleMute={toggleMute}
        onReconnect={startSession}
      />

      <button
        type="button"
        className={`sidebar-toggle ${sidebarOpen ? "is-open" : ""}`}
        onClick={() => setSidebarOpen((value) => !value)}
        aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        aria-expanded={sidebarOpen}
      >
        <span />
        <span />
        <span />
      </button>

      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}
      <motion.aside className="sidebar" aria-hidden={!sidebarOpen} initial={false} animate={{ opacity: sidebarOpen ? 1 : 0.85 }} transition={{ type: "spring", stiffness: 240, damping: 26 }}>
        <div className="brand">
          <span className="brand-icon">∑</span>
          <span className="brand-name"><span>Stepwise</span><span>Prism AI</span></span>
        </div>
        <button className="new-chat" onClick={newChat}>＋ New Chat</button>

        <div className="mode-switcher" aria-label="Question mode">
          <button
            type="button"
            className={mode === "standard" ? "active" : ""}
            aria-pressed={mode === "standard"}
            onClick={() => { setMode("standard"); setCoordinates([]); }}
          >
            Standard
          </button>
          <button
            type="button"
            className={mode === "graphical" ? "active" : ""}
            aria-pressed={mode === "graphical"}
            onClick={() => setMode("graphical")}
          >
            Graphical
          </button>
        </div>
        
        {/* History Section */}
        {history.length > 0 && (
          <div className="history-section">
            <div className="history-title">Chat History</div>
            <div className="history-list">
              {history.map((item) => (
                <button
                  key={item.id}
                  className="history-item"
                  onClick={() => viewHistoryItem(item.id)}
                  title={item.user_question}
                >
                  <span className="history-question">{item.user_question.substring(0, 30)}{item.user_question.length > 30 ? "..." : ""}</span>
                  <span className="history-score">{item.score}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        
        <div className="sidebar-bottom">
          <div className="username" title={user.username}>{user.username}</div>
          <button className="logout" onClick={onLogout}>Log out</button>
        </div>
      </motion.aside>

      <main className="main">
        <AnimatePresence mode="wait" initial={false}>
        {stage === "home" && (
          <motion.div key="home" className="home-content" initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.45, ease: "easeOut" }}>
            <div className="welcome">
              <h1>Hi, {user.username} 👋</h1>
              <p>“{quote}”</p>
            </div>

            <div className="composer-wrapper">
              {imagePreview && (
                <div className="image-preview">
                  <img src={imagePreview} alt="Selected question preview" />
                  <button type="button" onClick={removeImage} aria-label="Remove image">×</button>
                </div>
              )}

              {error && <div className="error composer-error" role="alert">{error}</div>}

              {mode === "graphical" && (
                <GraphEditor coordinates={coordinates} onChange={setCoordinates} />
              )}
              <Composer
                value={questionText}
                onChange={setQuestionText}
                onSubmit={submitQuestion}
                onImage={selectImage}
                onOpenVoice={() => {
                  setVoiceModalOpen(true);
                  void startSession(); // Starts audio IMMEDIATELY on click!
                }}
                disabled={imageUploading}
                graphical={mode === "graphical"}
              />
              {image && (
                <p className="attachment-name">
                  {imageUploading ? "Uploading image..." : image.name}
                </p>
              )}
            </div>
          </motion.div>
        )}

        {stage === "loading" && (
          <motion.div key="loading" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }} transition={{ type: "spring", stiffness: 120, damping: 18 }}><LoadingState message={loadingMessage} /></motion.div>
        )}

        {stage === "quiz" && questions[current] && (
          <motion.div key={`quiz-${current}`} initial={{ opacity: 0, x: 55, scale: 0.98 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -55, scale: 0.98 }} transition={{ type: "spring", stiffness: 120, damping: 20 }}>
          <Quiz
            question={questions[current]}
            current={current}
            total={questions.length}
            progress={progress}
            selected={answers[current] ?? null}
            showHint={showHint}
            onSelect={chooseAnswer}
            onHint={() => setShowHint(true)}
            onNext={nextQuestion}
            onPrevious={previousQuestion}
          />
          </motion.div>
        )}

        {stage === "result" && (
          <motion.div key="result" className="result-page" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -25 }} transition={{ duration: 0.5 }}>
            <div className="result-card">
              <span className="eyebrow">Practice complete</span>
              <h1>Quiz Complete!</h1>
              <div className="score">{score} / {questions.length}</div>
              <div className="progress-track" aria-label={`${questions.length ? Math.round((score / questions.length) * 100) : 0}% correct`}>
                <div style={{ width: `${questions.length ? (score / questions.length) * 100 : 0}%` }} />
              </div>
              <p>{questions.length ? Math.round((score / questions.length) * 100) : 0}% Correct</p>
            </div>

            {learnError && <div className="error review-error" role="alert">{learnError}</div>}

            <QuestionReview
              review={review}
              loadingIndex={learnLoadingIndex}
              onLearnAgain={learnAgain}
              hideLearnAgain={mode === "graphical"}
            />

            {showLearnResult && learnQuestions.length > 0 && (
              <LearnAgainResult
                score={learnScore}
                review={learnReview}
              />
            )}

            <button className="primary result-next" onClick={startOriginal}>Try Original Question</button>
          </motion.div>
        )}

        {stage === "learnAgain" && learnQuestions[learnCurrent] && (
          <motion.div key={`learn-${learnCurrent}`} initial={{ opacity: 0, x: 55, scale: 0.98 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -55, scale: 0.98 }} transition={{ type: "spring", stiffness: 120, damping: 20 }}>
          <Quiz
            question={learnQuestions[learnCurrent]}
            current={learnCurrent}
            total={learnQuestions.length}
            progress={learnProgress}
            selected={learnAnswers[learnCurrent] ?? null}
            showHint={showHint}
            learnAgain
            onSelect={chooseLearnAnswer}
            onHint={() => setShowHint(true)}
            onNext={nextLearnQuestion}
            onPrevious={() => {
              if (learnCurrent > 0) {
                setLearnCurrent((value) => value - 1);
                setShowHint(false);
              } else {
                setStage("result");
              }
            }}
          />
          </motion.div>
        )}

        {stage === "original" && originalQuestion && (
          <motion.div key="original" initial={{ opacity: 0, scale: 0.96, y: 25 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 1.03 }} transition={{ type: "spring", stiffness: 110, damping: 18 }}>
          <Quiz
            question={originalQuestion}
            current={0}
            total={1}
            progress={100}
            selected={finalAnswer}
            showHint={showHint}
            finalQuestion
            onSelect={setFinalAnswer}
            onHint={() => setShowHint(true)}
            onNext={submitOriginal}
            onPrevious={() => setStage("result")}
          />
          </motion.div>
        )}

        {stage === "evaluation" && originalQuestion && finalAnswer != null && (
          <motion.div key="evaluation" className="result-card final-result" initial={{ opacity: 0, scale: 0.82, y: 35 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ type: "spring", stiffness: 120, damping: 16 }}>
            {finalAnswer === originalQuestion.correct_option ? (
              <>
                <div className="result-icon correct-icon">✓</div>
                <h1>Correct! 🎉</h1>
                <p>
                  Correct answer:{" "}
                  <strong><MathText>{originalQuestion.options[originalQuestion.correct_option - 1]}</MathText></strong>
                </p>
                <p>You understood the concept.</p>
              </>
            ) : (
              <>
                <div className="result-icon incorrect-icon">×</div>
                <h1>Not quite.</h1>
                <p>
                  Correct answer:{" "}
                  <strong><MathText>{originalQuestion.options[originalQuestion.correct_option - 1]}</MathText></strong>
                </p>
                <p>Review the concept and try again.</p>
              </>
            )}
            {originalQuestion.solution && (
              <div className="solution-block">
                <div className="solution-label">Solution</div>
                <p>{originalQuestion.solution}</p>
              </div>
            )}
            <button className="primary" onClick={newChat}>Start New Chat</button>
          </motion.div>
        )}

        {stage === "history_view" && currentHistoryDetail && (
          <motion.div key="history" className="result-page history-result" initial={{ opacity: 0, y: 25 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.45 }}>
            <div className="result-card">
              <span className="eyebrow">History Entry</span>
              <h1>Quiz Result</h1>
              <div className="score">{currentHistoryDetail.score}</div>
              <div className="progress-track" aria-label="Score display">
                <div style={{ width: `${(() => {
                  const parts = currentHistoryDetail.score.split('/');
                  return parts.length === 2 ? Math.round((parseInt(parts[0]) / parseInt(parts[1])) * 100) : 0;
                })()}%` }} />
              </div>
              <p>{(() => {
                const parts = currentHistoryDetail.score.split('/');
                return parts.length === 2 ? Math.round((parseInt(parts[0]) / parseInt(parts[1])) * 100) : 0;
              })()}% Correct</p>
            </div>

            <HistoryReview historyDetail={currentHistoryDetail} />

            <button className="primary result-next" onClick={newChat}>Back to Home</button>
          </motion.div>
        )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <motion.div className="center-state" aria-live="polite" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.div
        className="spinner"
        aria-hidden="true"
        animate={{ rotate: 360 }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
      />
      <h2>{message}</h2>
      <p>Please wait while Stepwise Prism AI prepares your session.</p>
    </motion.div>
  );
}

function Composer({
  value,
  onChange,
  onSubmit,
  onImage,
  onOpenVoice,
  disabled,
  graphical,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onImage: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenVoice: () => void;
  disabled: boolean;
  graphical: boolean;
}) {
  const placeholder = "Ask your question...";

  return (
    <div className="composer-outer-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%' }}>
      
      {/* The main text input box */}
      <motion.div 
        className="composer" 
        style={{ flex: 1 }} 
        whileHover={{ y: -2 }} 
        transition={{ type: "spring", stiffness: 250, damping: 20 }}
      >
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          disabled={disabled}
        />
        
        {!graphical && (
          <label className="icon-button" aria-label="Upload image">
            📎
            <input
              type="file"
              accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"
              hidden
              onChange={onImage}
              disabled={disabled}
            />
          </label>
        )}
        
        <motion.button
          className="send"
          whileHover={{ scale: 1.08, rotate: -5 }}
          whileTap={{ scale: 0.9 }}
          onClick={onSubmit}
          disabled={disabled}
          aria-label="Send"
        >
          ➤
        </motion.button>
      </motion.div>

      {/* Voice Tutor Button - Now on the outside right and hidden in graphical mode! */}
      {!graphical && (
        <motion.button
          type="button"
          className="voice-btn-outside"
          whileHover={{ scale: 1.08, y: -2 }}
          whileTap={{ scale: 0.92 }}
          onClick={onOpenVoice}
          disabled={disabled}
          aria-label="Open Voice Tutor"
          title="Live Voice Tutor"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        </motion.button>
      )}
      
    </div>
  );
}

function GraphEditor({
  coordinates,
  onChange,
}: {
  coordinates: Coordinate[];
  onChange: (coordinates: Coordinate[]) => void;
}) {
  return (
    <motion.div className="graph-editor" initial={{ opacity: 0, height: 0, y: -10 }} animate={{ opacity: 1, height: "auto", y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ type: "spring", stiffness: 150, damping: 20 }}>
      <div className="graph-editor-header">
        <div>
          <strong>Graph</strong>
          <span>{coordinates.length}/4 points</span>
        </div>
        <div className="graph-editor-actions">
          <button
            type="button"
            className="graph-control"
            onClick={() => onChange([...coordinates, [0, 0]])}
            disabled={coordinates.length >= 4}
          >
            + Add point
          </button>
          <button
            type="button"
            className="graph-control"
            onClick={() => onChange(coordinates.slice(0, -1))}
            disabled={coordinates.length === 0}
          >
            − Remove point
          </button>
        </div>
      </div>
      <GraphCanvas coordinates={coordinates} editable onChange={onChange} />
      <p className="graph-help">Drag points to place them on the 20 × 20 grid.</p>
    </motion.div>
  );
}

function GraphCanvas({
  coordinates,
  editable = false,
  onChange,
}: {
  coordinates: Coordinate[];
  editable?: boolean;
  onChange?: (coordinates: Coordinate[]) => void;
}) {
  const size = 540;
  const graphPadding = 30;
  const origin = size / 2;
  const plotSize = size - graphPadding * 2;
  const largestCoordinate = coordinates.reduce(
    (largest, [x, y]) => Math.max(largest, Math.abs(x), Math.abs(y)),
    0,
  );
  const axisLimit = editable
    ? 20
    : Math.max(10, Math.ceil((largestCoordinate + 10) / 10) * 10);
  const unit = plotSize / (axisLimit * 2);
  const toSvg = ([x, y]: Coordinate) => [origin + x * unit, origin - y * unit];

  function movePoint(index: number, event: React.PointerEvent<SVGCircleElement>) {
    if (!editable || !onChange) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const update = (moveEvent: PointerEvent) => {
      const rect = svg.getBoundingClientRect();
      const x = ((moveEvent.clientX - rect.left) / rect.width) * size;
      const y = ((moveEvent.clientY - rect.top) / rect.height) * size;
      const next: Coordinate = [
        Math.max(-axisLimit, Math.min(axisLimit, Math.round(((x - origin) / unit) * 2) / 2)),
        Math.max(-axisLimit, Math.min(axisLimit, Math.round(((origin - y) / unit) * 2) / 2)),
      ];
      onChange(coordinates.map((point, pointIndex) => pointIndex === index ? next : point));
    };
    const stop = () => {
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", stop, { once: true });
  }

  return (
    <svg
      className={`graph-canvas ${editable ? "editable" : ""}`}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Coordinate graph"
      onPointerDown={(event) => { if (editable && event.target === event.currentTarget) event.preventDefault(); }}
    >
      <rect width={size} height={size} className="graph-background" />
      {Array.from({ length: 21 }, (_, index) => {
        const label = -axisLimit + index * (axisLimit / 10);
        const position = graphPadding + index * (plotSize / 20);
        return <g key={index}>
          <line x1={position} y1="0" x2={position} y2={size} className="graph-grid-line" />
          <line x1="0" y1={position} x2={size} y2={position} className="graph-grid-line" />
          {label !== 0 && label % 2 === 0 && <>
            <text x={position} y={origin + 16} textAnchor="middle" className="graph-coordinate-label">{label}</text>
            <text x={origin - 7} y={origin - label * unit + 4} textAnchor="end" className="graph-coordinate-label">{label}</text>
          </>}
        </g>;
      })}
      <line x1="0" y1={origin} x2={size} y2={origin} className="graph-axis" />
      <line x1={origin} y1={size} x2={origin} y2="0" className="graph-axis" />
      <text x="16" y={origin - 8} className="graph-axis-label">x&apos;</text>
      <text x={size - 18} y={origin - 8} className="graph-axis-label">x</text>
      <text x={origin + 8} y="20" className="graph-axis-label">y</text>
      <text x={origin + 8} y={size - 10} className="graph-axis-label">y&apos;</text>
      <text x={origin + 8} y={origin + 16} className="graph-axis-label">O</text>
      {coordinates.length >= 3 && <polygon points={coordinates.map(toSvg).map(([x, y]) => `${x},${y}`).join(" ")} className="graph-line" />}
      {coordinates.length === 2 && <polyline points={coordinates.map(toSvg).map(([x, y]) => `${x},${y}`).join(" ")} className="graph-line" />}
      {coordinates.map((point, index) => {
        const [x, y] = toSvg(point);
        return <g key={index}><circle cx={x} cy={y} r="8" className={`graph-point point-${index}`} onPointerDown={(event) => movePoint(index, event)} /><text x={x + 10} y={y - 10} className="graph-point-label">P{index + 1} ({point[0]}, {point[1]})</text></g>;
      })}
    </svg>
  );
}

function Quiz({
  question,
  current,
  total,
  progress,
  selected,
  showHint,
  finalQuestion = false,
  learnAgain = false,
  onSelect,
  onHint,
  onNext,
  onPrevious,
}: {
  question: Question;
  current: number;
  total: number;
  progress: number;
  selected: number | null;
  showHint: boolean;
  finalQuestion?: boolean;
  learnAgain?: boolean;
  onSelect: (option: number) => void;
  onHint: () => void;
  onNext: () => void;
  onPrevious: () => void;
}) {
  return (
    <motion.div className="quiz-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      <motion.div className="quiz-header" initial={{ y: -14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.35 }}>
        <span>
          {finalQuestion
            ? "Your original question"
            : learnAgain
              ? `Learn Again · Question ${current + 1} of ${total}`
              : `Question ${current + 1} of ${total}`}
        </span>
        {!finalQuestion && <div className="progress-track"><div style={{ width: `${progress}%` }} /></div>}
      </motion.div>

      <motion.section className="quiz-card" layout transition={{ type: "spring", stiffness: 170, damping: 24 }}>
      {question.coordinates && question.coordinates.length > 0 && <GraphCanvas coordinates={question.coordinates} />}
        <h1><MathText>{question.question}</MathText></h1>
        <motion.div className="options" role="radiogroup" aria-label="Answer options" variants={{ show: { transition: { staggerChildren: 0.07 } } }} initial="hidden" animate="show">
          {question.options.map((option, index) => {
            const number = index + 1;
            const selectedClass = selected === number ? " selected" : "";
            return (
              <motion.button
                key={`${number}-${option}`}
                variants={{ hidden: { opacity: 0, x: -20 }, show: { opacity: 1, x: 0 } }}
                whileHover={{ scale: 1.018, x: 5 }}
                whileTap={{ scale: 0.985 }}
                type="button"
                role="radio"
                aria-checked={selected === number}
                className={`option${selectedClass}`}
                onClick={() => onSelect(number)}
              >
                <span className="option-letter">{String.fromCharCode(64 + number)}</span>
                <MathText>{option}</MathText>
              </motion.button>
            );
          })}
        </motion.div>

        <div className="hint-area">
          {!showHint ? (
            <button type="button" className="hint-button" onClick={onHint}>💡 Need a hint?</button>
          ) : (
            <motion.div className="hint" initial={{ opacity: 0, height: 0, y: 8 }} animate={{ opacity: 1, height: "auto", y: 0 }} transition={{ type: "spring", stiffness: 170, damping: 20 }}>
              <strong>💡 Hint</strong>
              <MathText>{question.hint}</MathText>
            </motion.div>
          )}
        </div>

        <div className="quiz-actions">
          {current > 0 || finalQuestion ? (
            <button type="button" className="secondary" onClick={onPrevious}>← Previous</button>
          ) : <span />}
          <motion.button
            type="button"
            whileHover={{ scale: 1.035, y: -2 }}
            whileTap={{ scale: 0.97 }}
            className="primary"
            onClick={onNext}
            disabled={selected == null}
          >
            {finalQuestion ? "Submit Answer" : current === total - 1 ? "Finish →" : "Next →"}
          </motion.button>
        </div>
      </motion.section>
    </motion.div>
  );
}

type ReviewItem = {
  question: Question;
  index: number;
  selected: number | null;
  correct: boolean;
};

function QuestionReview({
  review,
  loadingIndex,
  onLearnAgain,
  hideLearnAgain = false,
}: {
  review: ReviewItem[];
  loadingIndex: number | null;
  onLearnAgain: (question: Question, index: number) => void;
  hideLearnAgain?: boolean;
}) {
  return (
    <section className="review-section" aria-labelledby="review-title">
      <div className="review-heading">
        <div>
          <span className="eyebrow">Performance</span>
          <h2 id="review-title">Question Review</h2>
        </div>
        <span className="review-count">{review.length} questions</span>
      </div>

      <div className="review-list">
        {review.map((item, index) => (
          <motion.article className="review-item" key={item.index} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.06, duration: 0.35 }} whileHover={{ y: -3, scale: 1.005 }}>
            <div className={`review-status ${item.correct ? "correct" : "incorrect"}`} aria-label={item.correct ? "Correct" : "Incorrect"}>
              {item.correct ? "✓" : "×"}
            </div>
            <div className="review-content">
              <div className="review-number">Question {item.index + 1}</div>
              <div className="review-question"><MathText>{item.question.question}</MathText></div>
              {item.selected != null && (
                <div className="review-answer">
                  Your answer: <strong><MathText>{item.question.options[item.selected - 1]}</MathText></strong>
                  {!item.correct && <> · Correct: <strong><MathText>{item.question.options[item.question.correct_option - 1]}</MathText></strong></>}
                </div>
              )}
            </div>
            {!item.correct && !hideLearnAgain && (
              <button
                type="button"
                className="secondary learn-button"
                onClick={() => onLearnAgain(item.question, item.index)}
                disabled={loadingIndex !== null}
              >
                {loadingIndex === item.index ? "Preparing..." : "Learn Again"}
              </button>
            )}
          </motion.article>
        ))}
      </div>
    </section>
  );
}

function LearnAgainResult({
  score,
  review,
}: {
  score: number;
  review: ReviewItem[];
}) {
  const incorrect = review.length - score;
  const percentage = review.length ? Math.round((score / review.length) * 100) : 0;

  return (
    <section className="learn-result-section" aria-labelledby="learn-result-title">
      <div className="learn-result-card">
        <span className="eyebrow">Learn Again Result</span>
        <h2 id="learn-result-title">Concept Practice Complete</h2>
        <div className="learn-score">{score} / {review.length}</div>
        <p>{percentage}% correct</p>

        <div className="learn-stats" aria-label="Learn Again score breakdown">
          <div className="learn-stat">
            <span className="learn-stat-value">{score}</span>
            <span>Correct</span>
          </div>
          <div className="learn-stat">
            <span className="learn-stat-value">{incorrect}</span>
            <span>Incorrect</span>
          </div>
        </div>
      </div>

      <div className="learn-review">
        <div className="review-heading">
          <div>
            <span className="eyebrow">Answer key</span>
            <h2>Learn Again Answers</h2>
          </div>
          <span className="review-count">{review.length} questions</span>
        </div>

        <div className="review-list">
          {review.map((item, index) => (
            <motion.article className="review-item learn-review-item" key={item.index} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.06, duration: 0.35 }} whileHover={{ y: -3, scale: 1.005 }}>
              <div
                className={`review-status ${item.correct ? "correct" : "incorrect"}`}
                aria-label={item.correct ? "Correct" : "Incorrect"}
              >
                {item.correct ? "✓" : "×"}
              </div>

              <div className="review-content">
                <div className="review-number">Question {item.index + 1}</div>
                <div className="review-question"><MathText>{item.question.question}</MathText></div>
                <div className="review-answer">
                  Your answer: <strong>
                    {item.selected != null
                      ? <MathText>{item.question.options[item.selected - 1]}</MathText>
                      : "Not answered"}
                  </strong>
                  {!item.correct && (
                    <> · Right answer: <strong><MathText>{item.question.options[item.question.correct_option - 1]}</MathText></strong></>
                  )}
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

function parseStoredList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {}

  return value.split(", ").map((item) => item.trim()).filter((item) => item.length > 0);
}

function HistoryReview({ historyDetail }: { historyDetail: HistoryDetail }) {
  const aiQuestionsList = parseStoredList(historyDetail.ai_questions);
  const aiAnswersList = parseStoredList(historyDetail.ai_answers);

  const wrongQuestions = historyDetail.wrong_answered_question
    ? historyDetail.wrong_answered_question
        .split(", ")
        .map((q) => q.trim())
        .filter((q) => q.length > 0)
    : [];

  const scoreParts = historyDetail.score.split("/");
  const totalQuestions = scoreParts.length === 2 ? parseInt(scoreParts[1]) : aiQuestionsList.length;
  const answersWithFallback = aiQuestionsList.map((_, index) => aiAnswersList[index] || "Not recorded");

  return (
    <section className="review-section history-review-section" aria-labelledby="history-review-title">
      <div className="review-heading">
        <div>
          <span className="eyebrow">Your Question</span>
          <h2 id="history-review-title">Question & Answer Review</h2>
        </div>
      </div>

      <div className="user-question-section">
        <div className="review-item user-question-review">
          <div className="review-content">
            <div className="review-label">Your Original Question</div>
            <div className="review-question">{historyDetail.user_question}</div>
          </div>
        </div>
      </div>

      <div className="review-heading" style={{ marginTop: "2rem" }}>
        <div>
          <span className="eyebrow">Practice Questions</span>
          <h3>Generated Questions & Your Responses</h3>
        </div>
        <span className="review-count">{totalQuestions} questions</span>
      </div>

      <div className="review-list">
        {aiQuestionsList.map((question, index) => {
          const isWrong = wrongQuestions.some((wq) => question.includes(wq) || wq.includes(question.substring(0, 30)));
          return (
            <article className="review-item history-review-item" key={index}>
              <div
                className={`review-status ${isWrong ? "incorrect" : "correct"}`}
                aria-label={isWrong ? "Incorrect" : "Correct"}
              >
                {isWrong ? "×" : "✓"}
              </div>
              <div className="review-content">
                <div className="review-number">Question {index + 1}</div>
                <div className="review-question"><MathText>{question}</MathText></div>
                <div className="review-answer">
                  Correct answer: <strong><MathText>{answersWithFallback[index]}</MathText></strong>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default App;