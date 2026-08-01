import { useState, useEffect, useCallback, useRef } from "react";
import {
  Heart, User, Phone, Mail, MapPin, Calendar, Droplets,
  AlertCircle, ChevronRight, ArrowLeft, CheckCircle, Plus,
  Activity, RefreshCw, MessageCircle, X, Send, Loader2,
  Lock, Eye, EyeOff, LogIn, UserPlus, Shield,
  LayoutDashboard, Users, ClipboardList, Trash2, Ban, CircleCheck, ChevronDown, ChevronUp,
  XCircle, AlertTriangle, Star, Award, Sparkles, Navigation
} from "lucide-react";

// ── Config ────────────────────────────────────────────────────────────────
const API = "https://khnbyexmdhqidpoimpal.supabase.co/functions/v1/make-server-fd15274a";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtobmJ5ZXhtZGhxaWRwb2ltcGFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyODcxMTcsImV4cCI6MjA5OTg2MzExN30.dN4CEzr6ZP4hZxrT-shxPW4h48q4WDEw7Efe7adM8LM";

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ANON_KEY}`,
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error ?? `Server error ${res.status}`;
    console.error(`[LifeLink API] ${options?.method ?? "GET"} ${path} → ${res.status}`, msg);
    throw new Error(msg);
  }
  return res.json();
}

// ── Location helpers ──────────────────────────────────────────────────────
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const geocodeCache = new Map<string, { lat: number; lon: number }>();
async function geocodeCity(city: string): Promise<{ lat: number; lon: number } | null> {
  const key = city.toLowerCase().trim();
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`, {
      headers: { "User-Agent": "LifeLink-App/1.0" },
    });
    const data = await res.json();
    if (data[0]) {
      const coords = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      geocodeCache.set(key, coords);
      return coords;
    }
  } catch { /* silent */ }
  return null;
}

function mapsDirectionsUrl(hospital: string, city: string) {
  const dest = encodeURIComponent(`${hospital}, ${city}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}

// ── Blood compatibility ───────────────────────────────────────────────────
type BloodGroup = "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-";

const COMPATIBLE_DONORS: Record<BloodGroup, BloodGroup[]> = {
  "A+":  ["O-", "O+", "A-", "A+"],
  "A-":  ["O-", "A-"],
  "B+":  ["O-", "O+", "B-", "B+"],
  "B-":  ["O-", "B-"],
  "AB+": ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"],
  "AB-": ["O-", "A-", "B-", "AB-"],
  "O+":  ["O-", "O+"],
  "O-":  ["O-"],
};

function isCompatible(donorGroup: BloodGroup, recipientGroup: BloodGroup) {
  return COMPATIBLE_DONORS[recipientGroup]?.includes(donorGroup) ?? false;
}

// ── Types ─────────────────────────────────────────────────────────────────
type UserRole = "donor" | "taker";
type AppScreen = "landing" | "login" | "register" | "dashboard" | "admin-login" | "admin";

interface HistoryRecord {
  id: string;
  requestId: string;
  responseId: string;
  donorId: string;
  donorName: string;
  donorBloodGroup: BloodGroup;
  donorPhone: string;
  donorEmail: string;
  donorCity: string;
  takerId: string;
  takerName: string;
  bloodGroup: BloodGroup;
  hospital: string;
  city: string;
  unitsRequired: number;
  urgency: UrgencyLevel;
  notes: string;
  completedAt: string;
  requestCreatedAt: string;
  role: "donor" | "taker";
}
type Gender = "Male" | "Female";
type UrgencyLevel = "Critical" | "High" | "Moderate" | "Low";

interface Profile {
  id: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  dob: string;
  gender: Gender;
  bloodGroup: BloodGroup;
  phone: string;
  altPhone?: string;
  email: string;
  address: string;
  city: string;
  state: string;
  lastDonationDate?: string;
  donationCount?: number;
  ratingAvg?: number;
  ratingCount?: number;
  medicalConditions?: string;
  availableTodonate?: boolean;
  createdAt: string;
}

interface BloodRequest {
  id: string;
  takerId: string;
  takerName: string;
  patientName?: string;
  bloodGroup: BloodGroup;
  urgency: UrgencyLevel;
  hospital: string;
  city: string;
  unitsRequired: number;
  reason: string;
  status: "open" | "fulfilled" | "closed";
  responseCount: number;
  createdAt: string;
}

interface DonorResponse {
  id: string;
  requestId: string;
  donorId: string;
  donorName: string;
  donorBloodGroup: BloodGroup;
  donorPhone: string;
  donorEmail: string;
  donorCity: string;
  takerId?: string;
  takerName?: string;
  message: string;
  status: "pending" | "accepted";
  createdAt: string;
}

interface ChatMessage {
  id: string;
  requestId: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
}

interface DonorRating {
  id: string;
  donorId: string;
  requestId: string;
  takerId: string;
  takerName: string;
  stars: number;
  note: string;
  createdAt: string;
}

interface Conversation {
  requestId: string;
  otherName: string;
  bloodGroup: BloodGroup;
  lastMessage?: ChatMessage;
  unreadCount: number;
}

function chatSeenKey(userId: string, requestId: string) {
  return `lifelink_chat_seen_${userId}_${requestId}`;
}
function markChatRead(userId: string, requestId: string) {
  localStorage.setItem(chatSeenKey(userId, requestId), new Date().toISOString());
}
function getLastSeen(userId: string, requestId: string): Date {
  const v = localStorage.getItem(chatSeenKey(userId, requestId));
  return v ? new Date(v) : new Date(0);
}

// ── Constants ─────────────────────────────────────────────────────────────
const BLOOD_GROUPS: BloodGroup[] = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const GENDERS: Gender[] = ["Male", "Female"];
const URGENCY_LEVELS: UrgencyLevel[] = ["Critical", "High", "Moderate", "Low"];

const URGENCY_COLORS: Record<UrgencyLevel, { card: string; badge: string; dot: string }> = {
  Critical: { card: "border-red-200 bg-red-50",    badge: "bg-red-100 text-red-700 border-red-200",       dot: "bg-red-500"    },
  High:     { card: "border-orange-200 bg-orange-50", badge: "bg-orange-100 text-orange-700 border-orange-200", dot: "bg-orange-500" },
  Moderate: { card: "border-amber-200 bg-amber-50", badge: "bg-amber-100 text-amber-700 border-amber-200",   dot: "bg-amber-400"  },
  Low:      { card: "border-green-200 bg-green-50",  badge: "bg-green-100 text-green-700 border-green-200",   dot: "bg-green-500"  },
};

// ── Helpers ───────────────────────────────────────────────────────────────
function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function timeAgo(d: string) {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── UI Atoms ──────────────────────────────────────────────────────────────
function BloodDropIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C12 2 4 9.5 4 14a8 8 0 0016 0C20 9.5 12 2 12 2z" />
    </svg>
  );
}

function Spinner({ className }: { className?: string }) {
  return <Loader2 className={`w-4 h-4 animate-spin ${className ?? ""}`} />;
}

function FormField({ label, required, children, hint }: {
  label: string; required?: boolean; children: React.ReactNode; hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-semibold text-foreground">
        {label}{required && <span className="text-primary ml-1">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function TextInput({ type = "text", placeholder, value, onChange, icon, right }: {
  type?: string; placeholder?: string; value: string;
  onChange: (v: string) => void; icon?: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <div className="relative">
      {icon && <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</div>}
      <input type={type} placeholder={placeholder} value={value}
        onChange={e => onChange(e.target.value)}
        className={`w-full ${icon ? "pl-10" : "px-4"} ${right ? "pr-11" : "pr-4"} py-3 bg-white border border-border rounded-xl text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all text-sm shadow-sm`} />
      {right && <div className="absolute right-3.5 top-1/2 -translate-y-1/2">{right}</div>}
    </div>
  );
}

function Select({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void; options: string[]; placeholder?: string;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full px-4 py-3 bg-white border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all text-sm appearance-none cursor-pointer shadow-sm">
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function BloodGroupSelector({ value, onChange }: { value: BloodGroup | ""; onChange: (v: BloodGroup) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {BLOOD_GROUPS.map(bg => (
        <button key={bg} type="button" onClick={() => onChange(bg)}
          className={`py-2.5 rounded-xl text-sm font-bold border-2 transition-all shadow-sm ${value === bg ? "bg-primary text-primary-foreground border-primary shadow-primary/20 shadow-md" : "bg-white border-border text-foreground hover:border-primary/50 hover:bg-accent"}`}>
          {bg}
        </button>
      ))}
    </div>
  );
}

function StarDisplay({ avg, count, size = "sm" }: { avg: number; count: number; size?: "sm" | "xs" }) {
  const sz = size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5";
  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map(s => (
          <Star key={s} className={`${sz} ${s <= Math.round(avg) ? "text-amber-400 fill-amber-400" : "text-muted-foreground/25 fill-muted-foreground/10"}`} />
        ))}
      </div>
      <span className={`${size === "xs" ? "text-[10px]" : "text-xs"} text-muted-foreground`}>
        {avg.toFixed(1)} ({count} review{count !== 1 ? "s" : ""})
      </span>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 flex gap-2.5 text-sm text-red-700">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{message}</span>
    </div>
  );
}

function PrimaryBtn({ children, onClick, loading, disabled, className }: {
  children: React.ReactNode; onClick?: () => void;
  loading?: boolean; disabled?: boolean; className?: string;
}) {
  return (
    <button onClick={onClick} disabled={loading || disabled}
      className={`w-full bg-primary text-primary-foreground py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 active:scale-[0.98] transition-all shadow-md shadow-primary/25 disabled:opacity-60 disabled:shadow-none ${className ?? ""}`}>
      {loading ? <Spinner /> : children}
    </button>
  );
}

// ── Forgot Password Modal ─────────────────────────────────────────────────
function ForgotPasswordModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"email" | "code" | "password">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const sendCode = async () => {
    if (!email.trim()) { setError("Please enter your email address."); return; }
    setLoading(true); setError("");
    try {
      await api("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email: email.trim() }) });
      setStep("code");
    } catch (e: any) { setError(e.message ?? "Failed to send code. Please try again."); }
    finally { setLoading(false); }
  };

  const verifyCode = async () => {
    if (!code.trim()) { setError("Please enter the 6-digit recovery code."); return; }
    if (code.trim().length !== 6) { setError("The recovery code must be exactly 6 digits."); return; }
    setLoading(true); setError("");
    try {
      await api("/auth/verify-recovery-code", { method: "POST", body: JSON.stringify({ email: email.trim(), code: code.trim() }) });
      setStep("password");
    } catch (e: any) { setError(e.message ?? "Invalid code. Please try again."); }
    finally { setLoading(false); }
  };

  const resetPassword = async () => {
    if (!newPw) { setError("Please enter a new password."); return; }
    if (newPw.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (newPw !== confirmPw) { setError("Passwords do not match."); return; }
    setLoading(true); setError("");
    try {
      await api("/auth/reset-password", { method: "POST", body: JSON.stringify({ email: email.trim(), code: code.trim(), newPassword: newPw }) });
      setDone(true);
    } catch (e: any) {
      setError(e.message ?? "Reset failed. Please check your code and try again.");
      if (e.message?.toLowerCase().includes("code") || e.message?.toLowerCase().includes("expired")) {
        setStep("code");
      }
    }
    finally { setLoading(false); }
  };

  const stepLabels = ["Email", "Verify Code", "New Password"];
  const stepIndex = step === "email" ? 0 : step === "code" ? 1 : 2;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl w-full max-w-md shadow-2xl border border-border">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-display font-bold text-foreground">Reset Password</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        {!done && (
          <div className="px-5 pt-4 flex items-center gap-2">
            {stepLabels.map((label, i) => (
              <div key={label} className="flex items-center gap-2 flex-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${i < stepIndex ? "bg-green-500 text-white" : i === stepIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {i < stepIndex ? <CheckCircle className="w-3.5 h-3.5" /> : i + 1}
                </div>
                <span className={`text-xs font-medium ${i === stepIndex ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
                {i < stepLabels.length - 1 && <div className={`flex-1 h-px ${i < stepIndex ? "bg-green-500" : "bg-border"}`} />}
              </div>
            ))}
          </div>
        )}

        <div className="p-5 space-y-4">
          {done ? (
            <div className="text-center py-4 space-y-3">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
              <p className="font-semibold text-foreground">Password reset successfully!</p>
              <p className="text-sm text-muted-foreground">You can now log in with your new password.</p>
              <button onClick={onClose} className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors">Back to Login</button>
            </div>
          ) : step === "email" ? (
            <>
              <p className="text-sm text-muted-foreground">Enter your registered email address. We&apos;ll check if an account exists and send a 6-digit recovery code.</p>
              <FormField label="Email Address" required>
                <TextInput type="email" placeholder="you@example.com" value={email} onChange={setEmail} icon={<Mail className="w-4 h-4" />} />
              </FormField>
              {error && <ErrorBox message={error} />}
              <PrimaryBtn loading={loading} onClick={sendCode}><Send className="w-4 h-4" /> Send Recovery Code</PrimaryBtn>
            </>
          ) : step === "code" ? (
            <>
              <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-3 text-xs text-green-800 dark:text-green-300 flex gap-2">
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-green-600" />
                <span>A 6-digit code was sent to <strong>{email}</strong>. Check your inbox and spam folder.</span>
              </div>
              <FormField label="6-Digit Recovery Code" required>
                <TextInput placeholder="e.g. 482910" value={code} onChange={v => setCode(v.replace(/\D/g, "").slice(0, 6))} icon={<Lock className="w-4 h-4" />} />
              </FormField>
              {error && <ErrorBox message={error} />}
              <PrimaryBtn loading={loading} onClick={verifyCode}><ChevronRight className="w-4 h-4" /> Continue</PrimaryBtn>
              <button onClick={() => { setStep("email"); setCode(""); setError(""); }} className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors">← Use a different email</button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Choose a strong new password for your account.</p>
              <FormField label="New Password" required>
                <TextInput type={showPw ? "text" : "password"} placeholder="At least 6 characters" value={newPw} onChange={setNewPw}
                  icon={<Lock className="w-4 h-4" />}
                  right={<button type="button" onClick={() => setShowPw(p => !p)} className="text-muted-foreground hover:text-foreground">{showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>} />
              </FormField>
              <FormField label="Confirm New Password" required>
                <TextInput type={showConfirmPw ? "text" : "password"} placeholder="Re-enter your new password" value={confirmPw} onChange={setConfirmPw}
                  icon={<Lock className="w-4 h-4" />}
                  right={<button type="button" onClick={() => setShowConfirmPw(p => !p)} className="text-muted-foreground hover:text-foreground">{showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>} />
              </FormField>
              {confirmPw && newPw !== confirmPw && (
                <p className="text-xs text-red-500 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> Passwords do not match</p>
              )}
              {confirmPw && newPw === confirmPw && newPw.length >= 6 && (
                <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Passwords match</p>
              )}
              {error && <ErrorBox message={error} />}
              <PrimaryBtn loading={loading} onClick={resetPassword}><CheckCircle className="w-4 h-4" /> Set New Password</PrimaryBtn>
              <button onClick={() => { setStep("code"); setError(""); }} className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors">← Re-enter recovery code</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Landing ───────────────────────────────────────────────────────────────
function LandingScreen({ onLogin, onRegister, onAdmin }: { onLogin: () => void; onRegister: () => void; onAdmin: () => void }) {
  const [stats, setStats] = useState<{ totalUsers: number; fulfilledRequests: number; cities: number } | null>(null);

  useEffect(() => {
    fetch(`${API}/stats/public`, { headers: { Authorization: `Bearer ${ANON_KEY}` } })
      .then(r => r.ok ? r.json() : null)
      .then(s => { if (s) setStats(s); })
      .catch(() => {});
  }, []);

  const statItems = [
    { val: stats ? stats.totalUsers.toLocaleString() : "—", label: "Members" },
    { val: stats ? stats.fulfilledRequests.toLocaleString() : "—", label: "Lives Saved" },
    { val: stats ? stats.cities.toLocaleString() : "—", label: "Cities" },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-md shadow-primary/30">
            <BloodDropIcon className="w-4.5 h-4.5 text-white" />
          </div>
          <span className="font-display text-lg font-bold text-foreground tracking-tight">LifeLink</span>
        </div>
        <button onClick={onAdmin} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-muted">
          <Shield className="w-3.5 h-3.5" /> Admin
        </button>
      </header>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <div className="max-w-md w-full text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-white border border-border text-foreground text-xs font-semibold px-4 py-2 rounded-full mb-8 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            Connecting donors across Bangladesh
          </div>

          {/* Big drop icon */}
          <div className="relative inline-flex mb-8">
            <div className="w-20 h-20 bg-primary rounded-2xl flex items-center justify-center shadow-2xl shadow-primary/40 rotate-3">
              <BloodDropIcon className="w-10 h-10 text-white" />
            </div>
            <div className="absolute -top-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-md">
              <CheckCircle className="w-3.5 h-3.5 text-white" />
            </div>
          </div>

          <h1 className="font-display text-4xl sm:text-5xl font-black text-foreground leading-[1.1] mb-4 tracking-tight">
            Every drop<br /><span className="text-primary">saves a life.</span>
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed mb-10 max-w-xs mx-auto">
            Connect with verified blood donors across Bangladesh — fast, safe, life-saving.
          </p>

          {/* CTA buttons */}
          <div className="flex flex-col gap-3 max-w-xs mx-auto">
            <button onClick={onLogin}
              className="flex items-center justify-center gap-2.5 bg-primary text-white py-4 rounded-2xl font-bold text-sm hover:bg-primary/90 active:scale-[0.98] transition-all shadow-lg shadow-primary/30">
              <LogIn className="w-4 h-4" /> Log In to Your Account
            </button>
            <button onClick={onRegister}
              className="flex items-center justify-center gap-2.5 bg-white text-foreground border-2 border-border py-4 rounded-2xl font-bold text-sm hover:border-primary/40 hover:bg-accent active:scale-[0.98] transition-all shadow-sm">
              <UserPlus className="w-4 h-4" /> Create Free Account
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-14 w-full max-w-xs">
          <div className="bg-white rounded-2xl border border-border shadow-sm p-5 grid grid-cols-3 divide-x divide-border">
            {statItems.map(s => (
              <div key={s.label} className="text-center px-3">
                <div className="text-xl font-black text-foreground font-display">{s.val}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5 font-medium">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Feature pills */}
        <div className="mt-6 flex flex-wrap justify-center gap-2 max-w-xs">
          {["Free to use", "Real-time matching", "Verified donors", "Google Maps directions"].map(f => (
            <span key={f} className="text-[11px] text-muted-foreground bg-white border border-border px-3 py-1 rounded-full font-medium">{f}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────
function LoginScreen({ onBack, onSuccess, onGoRegister }: {
  onBack: () => void; onSuccess: (p: Profile) => void; onGoRegister: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showForgot, setShowForgot] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) { setError("Please enter your email and password."); return; }
    setLoading(true); setError("");
    try {
      const { profile } = await api("/auth/login", {
        method: "POST", body: JSON.stringify({ email, password }),
      });
      onSuccess(profile);
    } catch (e: any) {
      const msg = e.message ?? "";
      if (msg.includes("needs re-registration")) {
        setError("This account was created before our login system was set up. Please create a new account with the same email.");
      } else if (msg.includes("No account found")) {
        setError("No account found with this email. Please check the email or create a new account.");
      } else if (msg.includes("Incorrect password")) {
        setError("Incorrect password. Please try again.");
      } else {
        setError(msg || "Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-6 py-4 flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-semibold">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center shadow-md shadow-primary/30">
            <BloodDropIcon className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-bold text-foreground">LifeLink</span>
        </div>
        <div className="w-16" />
      </header>

      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="w-14 h-14 rounded-2xl bg-accent border border-primary/15 flex items-center justify-center mb-5 shadow-sm">
              <LogIn className="w-6 h-6 text-primary" />
            </div>
            <h1 className="font-display text-3xl font-black text-foreground mb-1.5">Welcome back</h1>
            <p className="text-muted-foreground text-sm">Log in to continue saving lives.</p>
          </div>

          {error && <div className="mb-4"><ErrorBox message={error} /></div>}

          <div className="flex flex-col gap-4">
            <FormField label="Email Address" required>
              <TextInput type="email" placeholder="you@example.com" value={email} onChange={setEmail}
                icon={<Mail className="w-4 h-4" />} />
            </FormField>

            <FormField label="Password" required>
              <TextInput type={showPw ? "text" : "password"} placeholder="Enter your password"
                value={password} onChange={setPassword}
                icon={<Lock className="w-4 h-4" />}
                right={
                  <button type="button" onClick={() => setShowPw(p => !p)}
                    className="text-muted-foreground hover:text-foreground transition-colors">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                } />
            </FormField>

            <div className="flex justify-end">
              <button onClick={() => setShowForgot(true)} className="text-xs text-primary hover:underline transition-colors font-semibold">
                Forgot password?
              </button>
            </div>

            <PrimaryBtn loading={loading} onClick={handleLogin}>
              <LogIn className="w-4 h-4" /> Log In
            </PrimaryBtn>
          </div>

          <p className="text-center text-sm text-muted-foreground mt-6">
            {"Don't have an account? "}
            <button onClick={onGoRegister} className="text-primary font-bold hover:underline">Create one</button>
          </p>
        </div>
      </div>
      {showForgot && <ForgotPasswordModal onClose={() => setShowForgot(false)} />}
    </div>
  );
}

// ── Register Screen ───────────────────────────────────────────────────────
function RegisterScreen({ onBack, onComplete, onGoLogin }: {
  onBack: () => void; onComplete: (p: Profile) => void; onGoLogin: () => void;
}) {
  const [roleChosen, setRoleChosen] = useState(false);
  const [role, setRole] = useState<UserRole>("donor");
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isDonor = role === "donor";
  // Email verification state (inserted between step 2 and 3)
  const [emailVerified, setEmailVerified] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifySending, setVerifySending] = useState(false);
  const [verifyCodeSent, setVerifyCodeSent] = useState(false);

  const [form, setForm] = useState({
    firstName: "", lastName: "", dob: "", gender: "" as Gender | "",
    bloodGroup: "" as BloodGroup | "",
    email: "", password: "", confirmPassword: "",
    phone: "", address: "", city: "", state: "",
    lastDonationDate: "", medicalConditions: "", availableTodonate: true,
    urgency: "Moderate" as UrgencyLevel, hospital: "", unitsRequired: "1", reason: "",
  });
  const [showPw, setShowPw] = useState(false);
  const [showCpw, setShowCpw] = useState(false);

  const set = (key: keyof typeof form) => (val: string | boolean) =>
    setForm(f => ({ ...f, [key]: val }));

  // Steps: 1=Personal, 2=Credentials, 2.5=Email verify, 3=Contact, 4=Role-specific
  // We model this as steps 1-4 but inject a "verify" sub-step after step 2
  const totalSteps = 5; // personal → credentials → verify email → contact → role-specific
  const stepTitlesMap = [
    "Personal Information",
    "Login Credentials",
    "Verify Your Email",
    "Contact & Location",
    isDonor ? "Donor Details" : "Request Details",
  ];

  const handleSubmit = async () => {
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match."); return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters."); return;
    }
    setSaving(true); setError("");
    try {
      const { profile } = await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          role, email: form.email, password: form.password,
          firstName: form.firstName, lastName: form.lastName,
          dob: form.dob, gender: form.gender,
          bloodGroup: form.bloodGroup, phone: form.phone,
          address: form.address, city: form.city, state: form.state,
          lastDonationDate: form.lastDonationDate,
          medicalConditions: form.medicalConditions,
          availableTodonate: form.availableTodonate,
          urgency: form.urgency, hospital: form.hospital,
          unitsRequired: parseInt(form.unitsRequired) || 1,
          reason: form.reason,
        }),
      });

      if (!isDonor) {
        await api("/requests", {
          method: "POST",
          body: JSON.stringify({
            takerId: profile.id,
            takerName: `${form.firstName} ${form.lastName}`,
            bloodGroup: form.bloodGroup,
            urgency: form.urgency, hospital: form.hospital,
            city: form.city,
            unitsRequired: parseInt(form.unitsRequired) || 1,
            reason: form.reason,
          }),
        });
      }

      onComplete(profile);
    } catch (e: any) {
      setError(e.message ?? "Registration failed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Role chooser
  if (!roleChosen) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="px-6 py-5 border-b border-border flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="flex items-center gap-2">
            <BloodDropIcon className="w-5 h-5 text-primary" />
            <span className="font-display font-bold text-foreground">LifeLink</span>
          </div>
          <div className="w-12" />
        </header>

        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            <div className="w-12 h-12 rounded-xl bg-accent border border-primary/20 flex items-center justify-center mb-6">
              <UserPlus className="w-5 h-5 text-primary" />
            </div>
            <h1 className="font-display text-3xl font-extrabold text-foreground mb-1">Create account</h1>
            <p className="text-muted-foreground text-sm mb-8">First, tell us how you want to use LifeLink.</p>

            <div className="flex flex-col gap-3">
              <button onClick={() => { setRole("donor"); setRoleChosen(true); setStep(1); }}
                className="group bg-primary text-primary-foreground rounded-lg p-5 text-left hover:bg-primary/90 transition-all">
                <div className="flex items-center justify-between mb-2">
                  <div className="w-9 h-9 rounded-md bg-white/20 flex items-center justify-center"><Heart className="w-4 h-4" /></div>
                  <ChevronRight className="w-4 h-4 opacity-60 group-hover:opacity-100" />
                </div>
                <h2 className="font-bold text-lg mb-0.5">I want to donate blood</h2>
                <p className="text-primary-foreground/70 text-sm">Register as a donor and respond to requests.</p>
              </button>

              <button onClick={() => { setRole("taker"); setRoleChosen(true); setStep(1); }}
                className="group bg-card text-foreground border-2 border-border rounded-lg p-5 text-left hover:border-primary/30 transition-all">
                <div className="flex items-center justify-between mb-2">
                  <div className="w-9 h-9 rounded-md bg-secondary flex items-center justify-center"><Activity className="w-4 h-4 text-primary" /></div>
                  <ChevronRight className="w-4 h-4 opacity-40 group-hover:opacity-80" />
                </div>
                <h2 className="font-bold text-lg mb-0.5">I need blood</h2>
                <p className="text-muted-foreground text-sm">Post a request and get connected with donors.</p>
              </button>
            </div>

            <p className="text-center text-sm text-muted-foreground mt-6">
              Already have an account?{" "}
              <button onClick={onGoLogin} className="text-primary font-semibold hover:underline">Log in</button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-6 py-5 border-b border-border flex items-center justify-between">
        <button onClick={step === 1 ? () => setRoleChosen(false) : () => { setStep(s => s - 1); setError(""); }}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">
          <ArrowLeft className="w-4 h-4" />{step === 1 ? "Back" : "Previous"}
        </button>
        <div className="flex items-center gap-2">
          <BloodDropIcon className="w-5 h-5 text-primary" />
          <span className="font-display font-bold text-foreground">LifeLink</span>
        </div>
        <div className="text-sm text-muted-foreground font-medium">{step}/{totalSteps}</div>
      </header>

      <div className="h-1 bg-muted">
        <div className="h-full bg-primary transition-all duration-500 ease-out" style={{ width: `${(step / totalSteps) * 100}%` }} />
      </div>

      <div className="flex-1 max-w-xl mx-auto w-full px-6 py-10">
        <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full mb-4 ${isDonor ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground border border-border"}`}>
          {isDonor ? <Heart className="w-3 h-3" /> : <Activity className="w-3 h-3" />}
          {isDonor ? "Donor Registration" : "Blood Request Registration"}
        </div>
        <h1 className="font-display text-2xl font-bold text-foreground mb-1">{stepTitlesMap[step - 1]}</h1>
        <p className="text-muted-foreground text-sm mb-8">Step {step} of {totalSteps}</p>

        {/* Step 1 — Personal */}
        {step === 1 && (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="First Name" required>
                <TextInput placeholder="Rahim" value={form.firstName} onChange={set("firstName")} />
              </FormField>
              <FormField label="Last Name" required>
                <TextInput placeholder="Hossain" value={form.lastName} onChange={set("lastName")} />
              </FormField>
            </div>
            <FormField label="Date of Birth" required hint={isDonor ? "Must be 18–65 years to donate." : undefined}>
              <TextInput type="date" value={form.dob} onChange={set("dob")} />
            </FormField>
            <FormField label="Gender" required>
              <Select value={form.gender} onChange={set("gender") as any} options={GENDERS} placeholder="Select gender" />
            </FormField>
            <FormField label="Blood Group" required>
              <BloodGroupSelector value={form.bloodGroup} onChange={set("bloodGroup") as any} />
            </FormField>
          </div>
        )}

        {/* Step 2 — Credentials */}
        {step === 2 && (
          <div className="flex flex-col gap-5">
            <div className="bg-secondary rounded-lg p-4 flex gap-3 mb-1">
              <Shield className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <p className="text-xs text-foreground/70 leading-relaxed">
                You'll use this email and password to log back in and see your dashboard and status at any time.
              </p>
            </div>
            <FormField label="Email Address" required>
              <TextInput type="email" placeholder="you@example.com" value={form.email} onChange={set("email")}
                icon={<Mail className="w-4 h-4" />} />
            </FormField>
            <FormField label="Password" required hint="Minimum 6 characters.">
              <TextInput type={showPw ? "text" : "password"} placeholder="Create a password"
                value={form.password} onChange={set("password")}
                icon={<Lock className="w-4 h-4" />}
                right={
                  <button type="button" onClick={() => setShowPw(p => !p)}
                    className="text-muted-foreground hover:text-foreground transition-colors">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                } />
            </FormField>
            <FormField label="Confirm Password" required>
              <TextInput type={showCpw ? "text" : "password"} placeholder="Repeat your password"
                value={form.confirmPassword} onChange={set("confirmPassword")}
                icon={<Lock className="w-4 h-4" />}
                right={
                  <button type="button" onClick={() => setShowCpw(p => !p)}
                    className="text-muted-foreground hover:text-foreground transition-colors">
                    {showCpw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                } />
            </FormField>
          </div>
        )}

        {/* Step 3 — Email Verification */}
        {step === 3 && (
          <div className="flex flex-col gap-5">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
              <Mail className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-blue-900">Verify your email address</p>
                <p className="text-xs text-blue-700 mt-1 leading-relaxed">
                  We sent a 6-digit code to <strong>{form.email}</strong>. Enter it below to confirm your email is real.
                </p>
              </div>
            </div>
            {!verifyCodeSent ? (
              <button onClick={async () => {
                setVerifySending(true); setError("");
                try {
                  await api("/auth/send-verification", { method: "POST", body: JSON.stringify({ email: form.email }) });
                  setVerifyCodeSent(true);
                } catch (e: any) { setError(e.message ?? "Failed to send code."); }
                finally { setVerifySending(false); }
              }} disabled={verifySending}
                className="w-full bg-primary text-primary-foreground py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 transition-all shadow-md shadow-primary/25 disabled:opacity-60">
                {verifySending ? <Spinner /> : <><Send className="w-4 h-4" /> Send Verification Code</>}
              </button>
            ) : (
              <>
                <FormField label="6-Digit Verification Code" required>
                  <TextInput placeholder="e.g. 482910" value={verifyCode}
                    onChange={v => setVerifyCode(v.replace(/\D/g, "").slice(0, 6))}
                    icon={<Lock className="w-4 h-4" />} />
                </FormField>
                <button onClick={async () => {
                  if (verifyCode.length !== 6) { setError("Please enter the full 6-digit code."); return; }
                  setVerifySending(true); setError("");
                  try {
                    await api("/auth/verify-email-code", { method: "POST", body: JSON.stringify({ email: form.email, code: verifyCode }) });
                    setEmailVerified(true);
                    setStep(s => s + 1);
                  } catch (e: any) { setError(e.message ?? "Invalid code."); }
                  finally { setVerifySending(false); }
                }} disabled={verifySending || verifyCode.length !== 6}
                  className="w-full bg-primary text-primary-foreground py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 transition-all shadow-md shadow-primary/25 disabled:opacity-60">
                  {verifySending ? <Spinner /> : <><CheckCircle className="w-4 h-4" /> Verify &amp; Continue</>}
                </button>
                <button onClick={async () => {
                  setVerifyCode(""); setVerifyCodeSent(false); setError("");
                  setVerifySending(true);
                  try {
                    await api("/auth/send-verification", { method: "POST", body: JSON.stringify({ email: form.email }) });
                    setVerifyCodeSent(true);
                  } catch (e: any) { setError(e.message ?? "Failed to resend."); }
                  finally { setVerifySending(false); }
                }} className="text-center text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
                  Didn&apos;t receive it? Resend code
                </button>
              </>
            )}
          </div>
        )}

        {/* Step 4 — Contact */}
        {step === 4 && (
          <div className="flex flex-col gap-5">
            <FormField label="Phone Number" required>
              <TextInput type="tel" placeholder="01712 345678" value={form.phone} onChange={set("phone")}
                icon={<Phone className="w-4 h-4" />} />
            </FormField>
            <FormField label="Street Address" required>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                <textarea placeholder="House 12, Road 5, Dhanmondi..." value={form.address}
                  onChange={e => set("address")(e.target.value)} rows={2}
                  className="w-full pl-10 pr-3.5 py-2.5 bg-input-background border border-border rounded-md text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary transition-all text-sm resize-none" />
              </div>
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="City" required>
                <TextInput placeholder="Mumbai" value={form.city} onChange={set("city")} />
              </FormField>
              <FormField label="State" required>
                <TextInput placeholder="Dhaka Division" value={form.state} onChange={set("state")} />
              </FormField>
            </div>
          </div>
        )}

        {/* Step 5 — Donor specific */}
        {step === 5 && isDonor && (
          <div className="flex flex-col gap-5">
            <FormField label="Last Donation Date" hint="Leave blank if this is your first donation.">
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input type="date" value={form.lastDonationDate}
                  onChange={e => set("lastDonationDate")(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 bg-input-background border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary transition-all text-sm" />
              </div>
            </FormField>
            <FormField label="Medical Conditions" hint="Any conditions that may affect eligibility.">
              <textarea placeholder="e.g., None / Hypertension (controlled)..." value={form.medicalConditions}
                onChange={e => set("medicalConditions")(e.target.value)} rows={3}
                className="w-full px-3.5 py-2.5 bg-input-background border border-border rounded-md text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary transition-all text-sm resize-none" />
            </FormField>
            <FormField label="Currently Available to Donate?">
              <div className="flex gap-3">
                {[true, false].map(val => (
                  <button key={String(val)} type="button" onClick={() => set("availableTodonate")(val)}
                    className={`flex-1 py-2.5 rounded-md text-sm font-semibold border-2 transition-all ${form.availableTodonate === val ? (val ? "bg-primary text-primary-foreground border-primary" : "bg-foreground text-background border-foreground") : "bg-card border-border text-foreground hover:border-primary/40"}`}>
                    {val ? "Yes, available" : "Not right now"}
                  </button>
                ))}
              </div>
            </FormField>
            <div className="bg-accent border border-primary/20 rounded-md p-4 flex gap-3">
              <AlertCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <p className="text-xs text-foreground/70 leading-relaxed">
                By registering, you consent to be contacted when your blood group is urgently needed. Update availability anytime.
              </p>
            </div>
          </div>
        )}

        {/* Step 5 — Taker specific */}
        {step === 5 && !isDonor && (
          <div className="flex flex-col gap-5">
            <FormField label="Urgency Level" required>
              <div className="grid grid-cols-2 gap-2">
                {URGENCY_LEVELS.map(u => (
                  <button key={u} type="button" onClick={() => set("urgency")(u)}
                    className={`py-2.5 rounded-md text-sm font-semibold border-2 transition-all ${form.urgency === u ? URGENCY_COLORS[u].badge + " border-current" : "bg-card border-border text-foreground hover:border-primary/40"}`}>
                    {u}
                  </button>
                ))}
              </div>
            </FormField>
            <FormField label="Hospital / Location" required>
              <TextInput placeholder="Dhaka Medical College Hospital" value={form.hospital} onChange={set("hospital")} />
            </FormField>
            <FormField label="Units Required" required hint="1 unit ≈ 450 ml of whole blood.">
              <div className="flex gap-2">
                {["1", "2", "3", "4", "5+"].map(u => (
                  <button key={u} type="button" onClick={() => set("unitsRequired")(u)}
                    className={`flex-1 py-2.5 rounded-md text-sm font-bold border-2 transition-all ${form.unitsRequired === u ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`}>
                    {u}
                  </button>
                ))}
              </div>
            </FormField>
            <FormField label="Reason / Medical Notes">
              <textarea placeholder="e.g., Post-surgery recovery, accident trauma..." value={form.reason}
                onChange={e => set("reason")(e.target.value)} rows={3}
                className="w-full px-3.5 py-2.5 bg-input-background border border-border rounded-md text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary transition-all text-sm resize-none" />
            </FormField>
            <div className="bg-accent border border-primary/20 rounded-md p-4 flex gap-3">
              <AlertCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <p className="text-xs text-foreground/70 leading-relaxed">
                Your request will be visible to compatible donors immediately after registration.
              </p>
            </div>
          </div>
        )}

        {error && <div className="mt-4"><ErrorBox message={error} /></div>}

        <div className="mt-10">
          {step === 3 ? null /* step 3 has its own inline buttons */ : step < totalSteps ? (
            <PrimaryBtn loading={saving} onClick={async () => {
              setError("");
              if (step === 1) {
                if (!form.firstName || !form.lastName || !form.dob || !form.gender || !form.bloodGroup) {
                  setError("Please fill in all personal details."); return;
                }
              }
              if (step === 2) {
                if (!form.email || !form.password) { setError("Email and password are required."); return; }
                if (form.password !== form.confirmPassword) { setError("Passwords do not match."); return; }
                if (form.password.length < 6) { setError("Password must be at least 6 characters."); return; }
                setSaving(true);
                try {
                  const { taken } = await api(`/auth/check-email?email=${encodeURIComponent(form.email)}`);
                  if (taken) { setError("An account with this email already exists. Please log in instead."); return; }
                } catch { /* silent — let server catch it */ }
                finally { setSaving(false); }
                // Reset verification state when moving to verify step
                setVerifyCodeSent(false); setVerifyCode(""); setEmailVerified(false);
              }
              setStep(s => s + 1);
            }}>
              Continue <ChevronRight className="w-4 h-4" />
            </PrimaryBtn>
          ) : (
            <PrimaryBtn loading={saving} onClick={handleSubmit}>
              <CheckCircle className="w-4 h-4" />
              {isDonor ? "Complete Registration" : "Submit & Post Request"}
            </PrimaryBtn>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Respond Modal ─────────────────────────────────────────────────────────
function RespondModal({ request, profile, onClose, onSuccess }: {
  request: BloodRequest; profile: Profile; onClose: () => void; onSuccess: () => void;
}) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const handleSend = async () => {
    setSending(true); setError("");
    try {
      await api(`/requests/${request.id}/respond`, {
        method: "POST",
        body: JSON.stringify({
          donorId: profile.id, donorName: `${profile.firstName} ${profile.lastName}`,
          donorBloodGroup: profile.bloodGroup, donorPhone: profile.phone,
          donorEmail: profile.email, donorCity: profile.city, message,
        }),
      });
      onSuccess();
    } catch (e: any) {
      setError(e.message === "Already responded" ? "You have already responded to this request." : (e.message ?? "Failed to send."));
    } finally { setSending(false); }
  };

  const uc = URGENCY_COLORS[request.urgency];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl w-full max-w-md shadow-2xl border border-border">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-display font-bold text-foreground">Respond to Request</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">
          <div className={`rounded-lg border p-4 mb-5 ${uc.card}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-display font-extrabold text-xl text-primary">{request.bloodGroup}</span>
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${uc.badge}`}>{request.urgency}</span>
            </div>
            <p className="text-sm font-semibold text-foreground">{request.patientName || request.takerName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{request.hospital} · {request.city} · {request.unitsRequired} unit{request.unitsRequired > 1 ? "s" : ""}</p>
          </div>

          <div className="bg-secondary rounded-lg p-4 mb-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Your info shared with taker</p>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2 text-foreground"><User className="w-3.5 h-3.5 text-primary/60" />{profile.firstName} {profile.lastName} · {profile.bloodGroup}</div>
              <div className="flex items-center gap-2 text-foreground"><Phone className="w-3.5 h-3.5 text-primary/60" />{profile.phone}</div>
              <div className="flex items-center gap-2 text-foreground"><Mail className="w-3.5 h-3.5 text-primary/60" />{profile.email}</div>
              <div className="flex items-center gap-2 text-foreground"><MapPin className="w-3.5 h-3.5 text-primary/60" />{profile.city}</div>
            </div>
          </div>

          <FormField label="Message to taker (optional)">
            <textarea placeholder="e.g., I'm available today afternoon, please call me..."
              value={message} onChange={e => setMessage(e.target.value)} rows={3}
              className="w-full px-3.5 py-2.5 bg-input-background border border-border rounded-md text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary transition-all text-sm resize-none" />
          </FormField>

          {error && <div className="mt-3"><ErrorBox message={error} /></div>}

          <PrimaryBtn loading={sending} onClick={handleSend} className="mt-4">
            <Send className="w-4 h-4" /> Send Response
          </PrimaryBtn>
        </div>
      </div>
    </div>
  );
}

// ── Donor eligibility helpers ────────────────────────────────────────────
const DONATION_WAIT_DAYS = 56; // WHO recommended minimum between whole blood donations

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

function donorEligibility(lastDonationDate?: string): { eligible: boolean; daysLeft: number; daysSinceLast: number } {
  if (!lastDonationDate) return { eligible: true, daysLeft: 0, daysSinceLast: Infinity };
  const days = daysSince(lastDonationDate);
  const daysLeft = Math.max(0, DONATION_WAIT_DAYS - days);
  return { eligible: daysLeft === 0, daysLeft, daysSinceLast: days };
}

// ── Donation Warning Modal ────────────────────────────────────────────────
function DonationWarningModal({ daysLeft, daysSinceLast, onProceed, onCancel }: {
  daysLeft: number; daysSinceLast: number; onProceed: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl w-full max-w-md shadow-2xl border border-border">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-display font-bold text-foreground flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-500" /> Donation Interval Warning
          </h2>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5">
            <p className="font-semibold text-amber-800 text-sm mb-1">You donated {daysSinceLast} day{daysSinceLast !== 1 ? "s" : ""} ago</p>
            <p className="text-sm text-amber-700">
              The WHO recommends waiting <strong>{DONATION_WAIT_DAYS} days</strong> between whole blood donations to allow your body to fully recover.
              You still have <strong>{daysLeft} day{daysLeft !== 1 ? "s" : ""}</strong> remaining in the recommended rest period.
            </p>
          </div>

          <div className="space-y-2 text-sm text-muted-foreground mb-5">
            <div className="flex items-start gap-2"><span className="text-amber-500 mt-0.5">⚠</span> Donating too soon may cause fatigue, dizziness, or iron deficiency.</div>
            <div className="flex items-start gap-2"><span className="text-amber-500 mt-0.5">⚠</span> Your haemoglobin levels may not have fully recovered yet.</div>
            <div className="flex items-start gap-2"><span className="text-green-600 mt-0.5">✓</span> If this is a critical emergency and you feel healthy, you may still proceed.</div>
          </div>

          <div className="flex gap-3">
            <button onClick={onCancel}
              className="flex-1 py-2.5 rounded-md border-2 border-border text-foreground font-semibold text-sm hover:border-primary/30 transition-colors">
              Wait — Not yet
            </button>
            <button onClick={onProceed}
              className="flex-1 py-2.5 rounded-md bg-amber-500 text-white font-semibold text-sm hover:bg-amber-600 transition-colors flex items-center justify-center gap-2">
              <Heart className="w-4 h-4" /> Proceed Anyway
            </button>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-3">Please consult a doctor if you are unsure about your eligibility.</p>
        </div>
      </div>
    </div>
  );
}

// ── New Request Modal (for takers) ────────────────────────────────────────
function NewRequestModal({ profile, onClose, onSuccess }: {
  profile: Profile; onClose: () => void; onSuccess: (req: BloodRequest) => void;
}) {
  const [form, setForm] = useState({
    bloodGroup: profile.bloodGroup as BloodGroup,
    patientName: `${profile.firstName} ${profile.lastName}`,
    urgency: "Moderate" as UrgencyLevel,
    hospital: "",
    city: profile.city,
    unitsRequired: "1",
    reason: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");
  const [hospitalSuggestions, setHospitalSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchingHospital, setSearchingHospital] = useState(false);
  const hospitalSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = (k: keyof typeof form) => (v: any) => setForm(f => ({ ...f, [k]: v }));

  const detectLocation = () => {
    if (!navigator.geolocation) { setLocError("Geolocation not supported by your browser."); return; }
    setLocating(true); setLocError("");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`,
            { headers: { "User-Agent": "LifeLink-App/1.0" } }
          );
          const data = await res.json();
          const city = data.address?.city || data.address?.town || data.address?.village || data.address?.county || "";
          if (city) setForm(f => ({ ...f, city }));
          else setLocError("Could not determine city from your location.");
        } catch { setLocError("Failed to fetch location details."); }
        finally { setLocating(false); }
      },
      () => { setLocError("Location access denied. Please allow location or type manually."); setLocating(false); },
      { timeout: 8000 }
    );
  };

  const searchHospital = async (query: string) => {
    set("hospital")(query);
    if (!query.trim() || query.length < 3) { setHospitalSuggestions([]); setShowSuggestions(false); return; }
    if (hospitalSearchTimer.current) clearTimeout(hospitalSearchTimer.current);
    hospitalSearchTimer.current = setTimeout(async () => {
      setSearchingHospital(true);
      try {
        const searchQuery = form.city ? `${query} hospital ${form.city}` : `${query} hospital`;
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=5&addressdetails=1`,
          { headers: { "User-Agent": "LifeLink-App/1.0" } }
        );
        const data = await res.json();
        const names = data
          .filter((d: any) => d.display_name)
          .map((d: any) => {
            const parts = d.display_name.split(",");
            return parts.slice(0, 3).join(",").trim();
          });
        setHospitalSuggestions([...new Set<string>(names)].slice(0, 5));
        setShowSuggestions(true);
      } catch { /* silent */ }
      finally { setSearchingHospital(false); }
    }, 400);
  };

  const handleSubmit = async () => {
    if (!form.hospital || !form.city) { setError("Hospital and city are required."); return; }
    if (!form.patientName.trim()) { setError("Patient name is required."); return; }
    setSaving(true); setError("");
    try {
      const { request } = await api("/requests", {
        method: "POST",
        body: JSON.stringify({
          takerId: profile.id,
          takerName: `${profile.firstName} ${profile.lastName}`,
          patientName: form.patientName.trim(),
          bloodGroup: form.bloodGroup,
          urgency: form.urgency,
          hospital: form.hospital,
          city: form.city,
          unitsRequired: parseInt(form.unitsRequired) || 1,
          reason: form.reason,
        }),
      });
      onSuccess(request);
    } catch (e: any) {
      setError(e.message ?? "Failed to post request.");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl w-full max-w-md shadow-2xl border border-border max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card">
          <div>
            <h2 className="font-display font-bold text-foreground">New Blood Request</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Fill in the details for the patient who needs blood</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          {error && <ErrorBox message={error} />}

          <FormField label="Patient Name" required hint="Who needs the blood?">
            <TextInput placeholder="e.g. John Doe (or your own name)" value={form.patientName} onChange={set("patientName")} />
          </FormField>

          <FormField label="Blood Group Required" required>
            <BloodGroupSelector value={form.bloodGroup} onChange={set("bloodGroup")} />
          </FormField>

          <FormField label="Urgency Level" required>
            <div className="grid grid-cols-2 gap-2">
              {URGENCY_LEVELS.map(u => (
                <button key={u} type="button" onClick={() => set("urgency")(u)}
                  className={`py-2.5 rounded-md text-sm font-semibold border-2 transition-all ${form.urgency === u ? URGENCY_COLORS[u].badge + " border-current" : "bg-card border-border text-foreground hover:border-primary/40"}`}>
                  {u}
                </button>
              ))}
            </div>
          </FormField>

          <FormField label="Hospital / Location" required>
            <div className="relative">
              <div className="relative">
                <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search hospital name…"
                  value={form.hospital}
                  onChange={e => searchHospital(e.target.value)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  onFocus={() => hospitalSuggestions.length > 0 && setShowSuggestions(true)}
                  className="w-full pl-10 pr-10 py-3 bg-white border border-border rounded-xl text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all text-sm shadow-sm"
                />
                {searchingHospital && <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />}
              </div>
              {showSuggestions && hospitalSuggestions.length > 0 && (
                <div className="absolute z-10 w-full bg-white border border-border rounded-xl shadow-lg mt-1 overflow-hidden">
                  {hospitalSuggestions.map((s, i) => (
                    <button key={i} type="button"
                      onMouseDown={() => { set("hospital")(s); setShowSuggestions(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted transition-colors border-b border-border last:border-0 text-foreground">
                      <MapPin className="inline w-3 h-3 text-primary mr-2" />{s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </FormField>

          <FormField label="City" required>
            <div className="flex gap-2">
              <div className="flex-1">
                <TextInput placeholder="Dhaka" value={form.city} onChange={set("city")} icon={<MapPin className="w-4 h-4" />} />
              </div>
              <button type="button" onClick={detectLocation} disabled={locating}
                className="shrink-0 flex items-center gap-1.5 px-3 py-3 bg-primary/10 border border-primary/25 text-primary rounded-xl text-xs font-bold hover:bg-primary/20 transition-colors disabled:opacity-60">
                {locating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />}
                {locating ? "…" : "Detect"}
              </button>
            </div>
            {locError && <p className="text-xs text-red-500 mt-1">{locError}</p>}
            {!locError && form.city && (
              <a href={mapsDirectionsUrl(form.hospital || "hospital", form.city)} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1 font-medium">
                <MapPin className="w-3 h-3" /> Preview on Google Maps
              </a>
            )}
          </FormField>

          <FormField label="Units Required" required hint="1 unit ≈ 450 ml of whole blood.">
            <div className="flex gap-2">
              {["1", "2", "3", "4", "5+"].map(u => (
                <button key={u} type="button" onClick={() => set("unitsRequired")(u)}
                  className={`flex-1 py-2.5 rounded-md text-sm font-bold border-2 transition-all ${form.unitsRequired === u ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`}>
                  {u}
                </button>
              ))}
            </div>
          </FormField>

          <FormField label="Reason / Medical Notes">
            <textarea placeholder="e.g., Post-surgery, accident trauma, scheduled procedure…"
              value={form.reason} onChange={e => set("reason")(e.target.value)} rows={3}
              className="w-full px-3.5 py-2.5 bg-input-background border border-border rounded-md text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary transition-all text-sm resize-none" />
          </FormField>

          <PrimaryBtn loading={saving} onClick={handleSubmit}>
            <Plus className="w-4 h-4" /> Post Request
          </PrimaryBtn>
        </div>
      </div>
    </div>
  );
}

// ── Cancel Request Modal ──────────────────────────────────────────────────
function CancelRequestModal({ request, profile, onClose, onSuccess }: {
  request: BloodRequest; profile: Profile; onClose: () => void; onSuccess: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleCancel = async () => {
    setSaving(true); setError("");
    try {
      await api(`/requests/${request.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ takerId: profile.id }),
      });
      onSuccess();
    } catch (e: any) {
      setError(e.message ?? "Failed to cancel request.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl w-full max-w-md shadow-2xl border border-border">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-display font-bold text-foreground">Cancel Blood Request</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Are you sure?</p>
              <p className="text-xs text-amber-700 mt-1">
                This will close the request for <span className="font-semibold">{request.patientName || request.takerName}</span> ({request.bloodGroup}) and no further donors will see it. This cannot be undone.
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">If blood has already been arranged from another source, cancelling lets the community know the need has been met.</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors">Keep Request</button>
            <button onClick={handleCancel} disabled={saving} className="flex-1 py-2.5 rounded-lg bg-destructive text-destructive-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
              {saving && <Spinner />} Cancel Request
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Fulfill Modal ─────────────────────────────────────────────────────────
function FulfillModal({ response, requestId, onClose, onSuccess }: {
  response: DonorResponse; requestId: string; onClose: () => void; onSuccess: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleFulfill = async () => {
    setLoading(true); setError("");
    try {
      await api(`/requests/${requestId}/fulfill`, {
        method: "POST",
        body: JSON.stringify({ responseId: response.id, notes }),
      });
      onSuccess();
    } catch (e: any) {
      setError(e.message ?? "Failed. Please try again.");
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl w-full max-w-md shadow-2xl border border-border">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-display font-bold text-foreground">Confirm Donation Completed</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-5 flex gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-green-800 text-sm">Mark donation as complete</p>
              <p className="text-xs text-green-700 mt-0.5">
                Confirming that <strong>{response.donorName}</strong> ({response.donorBloodGroup}) donated blood successfully. This will be recorded in both your and the donor's history.
              </p>
            </div>
          </div>

          <div className="bg-secondary rounded-lg p-3 mb-5 space-y-1.5 text-sm">
            <div className="flex items-center gap-2 text-foreground"><User className="w-3.5 h-3.5 text-primary/60" />{response.donorName} · {response.donorBloodGroup}</div>
            <div className="flex items-center gap-2 text-foreground"><Phone className="w-3.5 h-3.5 text-primary/60" />{response.donorPhone}</div>
            <div className="flex items-center gap-2 text-foreground"><MapPin className="w-3.5 h-3.5 text-primary/60" />{response.donorCity}</div>
          </div>

          <FormField label="Add a note of thanks (optional)">
            <textarea placeholder="e.g., Thank you so much, your donation was life-saving…"
              value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              className="w-full px-3.5 py-2.5 bg-input-background border border-border rounded-md text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary transition-all text-sm resize-none" />
          </FormField>

          {error && <div className="mt-3"><ErrorBox message={error} /></div>}

          <PrimaryBtn loading={loading} onClick={handleFulfill} className="mt-4 bg-green-600 hover:bg-green-700">
            <CheckCircle className="w-4 h-4" /> Confirm Donation Complete
          </PrimaryBtn>
          <p className="text-xs text-muted-foreground text-center mt-2">The donor will be notified by email with your note.</p>
        </div>
      </div>
    </div>
  );
}

// ── Browser push notifications ────────────────────────────────────────────
async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

function showBrowserNotification(title: string, body: string) {
  if (Notification.permission !== "granted") return;
  new Notification(title, { body, icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='%23c0152a' d='M12 2C12 2 4 9.5 4 14a8 8 0 0016 0C20 9.5 12 2 12 2z'/></svg>" });
}

// ── Edit Profile Modal ────────────────────────────────────────────────────
function EditProfileModal({ profile, onClose, onSuccess }: {
  profile: Profile; onClose: () => void; onSuccess: (updated: Profile) => void;
}) {
  const [form, setForm] = useState({
    firstName: profile.firstName,
    lastName: profile.lastName,
    phone: profile.phone,
    altPhone: profile.altPhone ?? "",
    address: profile.address,
    city: profile.city,
    state: profile.state,
    medicalConditions: profile.medicalConditions ?? "",
    availableTodonate: profile.availableTodonate ?? true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (key: string, val: any) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = async () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.phone.trim() || !form.address.trim() || !form.city.trim() || !form.state.trim()) {
      setError("Name, phone, and address fields are required."); return;
    }
    setLoading(true); setError("");
    try {
      const data = await api(`/profiles/${profile.id}`, { method: "PUT", body: JSON.stringify(form) });
      if (data.error) { setError(data.error); return; }
      onSuccess(data.profile);
    } catch { setError("Something went wrong."); }
    finally { setLoading(false); }
  };

  const field = (label: string, key: string, type = "text", hint?: string) => (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {label}{hint && <span className="ml-1 font-normal normal-case text-muted-foreground">{hint}</span>}
      </label>
      <input type={type} value={(form as any)[key]} onChange={e => set(key, e.target.value)}
        className="w-full mt-1 px-3 py-2 rounded-md bg-input-background border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h3 className="font-display font-bold text-foreground">Edit Profile</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-4 flex-1">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Personal Information</p>
          <div className="grid grid-cols-2 gap-3">
            {field("First Name", "firstName")}
            {field("Last Name", "lastName")}
          </div>

          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest pt-2">Contact</p>
          {field("Phone Number", "phone", "tel")}
          {field("Alternative Phone", "altPhone", "tel", "(optional)")}

          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest pt-2">Address</p>
          {field("Street Address", "address")}
          <div className="grid grid-cols-2 gap-3">
            {field("City", "city")}
            {field("State / Province", "state")}
          </div>

          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest pt-2">Donor Details</p>
          {field("Medical Conditions", "medicalConditions", "text", "(optional)")}
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => set("availableTodonate", !form.availableTodonate)}
              className={`w-10 h-6 rounded-full transition-colors relative ${form.availableTodonate ? "bg-primary" : "bg-border"}`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.availableTodonate ? "translate-x-4" : "translate-x-0.5"}`} />
            </button>
            <span className="text-sm text-foreground font-medium">Available to donate</span>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border shrink-0 space-y-2">
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button onClick={handleSave} disabled={loading}
            className="w-full bg-primary text-primary-foreground py-2.5 rounded-md font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {loading ? <><Spinner /> Saving…</> : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Change Name Modal ─────────────────────────────────────────────────────
function ChangeNameModal({ profile, onClose, onSuccess }: {
  profile: Profile; onClose: () => void; onSuccess: (updated: Profile) => void;
}) {
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!firstName.trim() || !lastName.trim()) { setError("Both fields are required."); return; }
    setLoading(true); setError("");
    try {
      const data = await api(`/profiles/${profile.id}/name`, {
        method: "PUT",
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() }),
      });
      if (data.error) { setError(data.error); return; }
      onSuccess(data.profile);
    } catch { setError("Something went wrong."); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-display font-bold text-foreground">Change Name</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">First Name</label>
            <input value={firstName} onChange={e => setFirstName(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-md bg-input-background border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Last Name</label>
            <input value={lastName} onChange={e => setLastName(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-md bg-input-background border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button onClick={handleSave} disabled={loading}
            className="w-full bg-primary text-primary-foreground py-2.5 rounded-md font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {loading ? <><Spinner /> Saving…</> : "Save Name"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Change Password Modal ──────────────────────────────────────────────────
function ChangePasswordModal({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSave = async () => {
    if (!current || !next || !confirm) { setError("All fields are required."); return; }
    if (next.length < 6) { setError("New password must be at least 6 characters."); return; }
    if (next !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true); setError("");
    try {
      const data = await api(`/profiles/${profile.id}/password`, {
        method: "PUT",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (data.error) { setError(data.error); return; }
      setDone(true);
    } catch { setError("Something went wrong."); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-display font-bold text-foreground">Change Password</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        {done ? (
          <div className="text-center py-6">
            <CheckCircle className="w-10 h-10 text-green-600 mx-auto mb-3" />
            <p className="font-semibold text-foreground">Password updated!</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">Your new password is active.</p>
            <button onClick={onClose} className="w-full bg-primary text-primary-foreground py-2.5 rounded-md font-semibold text-sm hover:bg-primary/90 transition-colors">Done</button>
          </div>
        ) : (
          <div className="space-y-3">
            {[
              { label: "Current Password", val: current, set: setCurrent, show: showCurrent, toggle: () => setShowCurrent(p => !p) },
              { label: "New Password",     val: next,    set: setNext,    show: showNext,    toggle: () => setShowNext(p => !p) },
              { label: "Confirm New Password", val: confirm, set: setConfirm, show: showNext, toggle: () => setShowNext(p => !p) },
            ].map(f => (
              <div key={f.label}>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{f.label}</label>
                <div className="relative mt-1">
                  <input type={f.show ? "text" : "password"} value={f.val} onChange={e => f.set(e.target.value)}
                    className="w-full px-3 py-2 pr-9 rounded-md bg-input-background border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                  <button type="button" onClick={f.toggle} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {f.show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ))}
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button onClick={handleSave} disabled={loading}
              className="w-full bg-primary text-primary-foreground py-2.5 rounded-md font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {loading ? <><Spinner /> Saving…</> : "Update Password"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Chat Modal ────────────────────────────────────────────────────────────
function ChatModal({ requestId, currentUserId, currentUserName, otherName, onClose }: {
  requestId: string; currentUserId: string; currentUserName: string; otherName: string; onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    try {
      const { messages: msgs } = await api(`/chat/${requestId}`);
      setMessages(msgs ?? []);
    } catch { /* silent */ }
  }, [requestId]);

  useEffect(() => { loadMessages(); }, [loadMessages]);
  useEffect(() => { const t = setInterval(loadMessages, 5000); return () => clearInterval(t); }, [loadMessages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await api(`/chat/${requestId}`, {
        method: "POST",
        body: JSON.stringify({ senderId: currentUserId, senderName: currentUserName, text }),
      });
      setText("");
      await loadMessages();
    } catch { /* silent */ } finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl w-full max-w-md shadow-2xl border border-border flex flex-col" style={{ maxHeight: "80vh" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-display font-bold text-foreground">Chat</h2>
            <p className="text-xs text-muted-foreground">with {otherName}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {messages.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-8">No messages yet. Start the conversation!</p>
          ) : messages.map(m => {
            const mine = m.senderId === currentUserId;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-xl px-3.5 py-2.5 text-sm ${mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-secondary text-foreground rounded-bl-sm"}`}>
                  {!mine && <p className="text-[10px] font-semibold opacity-70 mb-0.5">{m.senderName}</p>}
                  <p className="leading-relaxed">{m.text}</p>
                  <p className={`text-[10px] mt-1 ${mine ? "text-primary-foreground/60 text-right" : "text-muted-foreground"}`}>{timeAgo(m.createdAt)}</p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
        <div className="px-4 py-3 border-t border-border shrink-0 flex gap-2">
          <input
            value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Type a message…"
            className="flex-1 px-3.5 py-2.5 bg-input-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary transition-all"
          />
          <button onClick={send} disabled={sending || !text.trim()}
            className="bg-primary text-primary-foreground px-3.5 py-2.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
            {sending ? <Spinner /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rating Modal ──────────────────────────────────────────────────────────
function RatingModal({ donorId, donorName, requestId, takerId, takerName, onClose, onSuccess }: {
  donorId: string; donorName: string; requestId: string;
  takerId: string; takerName: string; onClose: () => void; onSuccess: () => void;
}) {
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (stars === 0) { setError("Please select a star rating."); return; }
    setSaving(true); setError("");
    try {
      await api(`/ratings/${donorId}`, {
        method: "POST",
        body: JSON.stringify({ requestId, takerId, takerName, stars, note }),
      });
      onSuccess();
    } catch (e: any) {
      setError(e.message === "Already rated" ? "You have already rated this donor." : (e.message ?? "Failed to submit rating."));
    } finally { setSaving(false); }
  };

  const labels = ["", "Poor", "Fair", "Good", "Great", "Excellent"];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl w-full max-w-md shadow-2xl border border-border">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-display font-bold text-foreground">Rate Your Donor</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-5">
          <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center font-display font-bold text-xl mx-auto mb-2">
              {donorName.split(" ").map(n => n[0]).join("").slice(0, 2)}
            </div>
            <p className="font-semibold text-foreground">{donorName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">How was your experience?</p>
          </div>
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map(s => (
              <button key={s} onClick={() => setStars(s)} onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(0)}
                className="transition-transform hover:scale-110">
                <Star className={`w-9 h-9 transition-colors ${s <= (hover || stars) ? "text-amber-400 fill-amber-400" : "text-muted-foreground/30"}`} />
              </button>
            ))}
          </div>
          {(hover || stars) > 0 && (
            <p className="text-center text-sm font-semibold text-amber-600">{labels[hover || stars]}</p>
          )}
          <div>
            <label className="text-sm font-semibold text-foreground block mb-1.5">Leave a note <span className="font-normal text-muted-foreground">(optional)</span></label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="Share your experience with this donor…"
              className="w-full px-3.5 py-2.5 bg-input-background border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary resize-none transition-all" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors">Skip</button>
            <button onClick={submit} disabled={saving || stars === 0}
              className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
              {saving && <Spinner />} Submit Rating
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Onboarding Modal ──────────────────────────────────────────────────────
function OnboardingModal({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const steps = [
    {
      icon: <Droplets className="w-10 h-10 text-primary" />,
      title: "Welcome to LifeLink!",
      body: `Hi ${profile.firstName}! LifeLink connects blood donors with people in need — fast and directly. You can both donate blood and request it at any time.`,
    },
    {
      icon: <Heart className="w-10 h-10 text-primary" />,
      title: "Donate Blood",
      body: "Go to the Donate Blood tab to see requests compatible with your blood group. Respond to a request and the requester will receive your contact details instantly.",
    },
    {
      icon: <MessageCircle className="w-10 h-10 text-primary" />,
      title: "Request & Coordinate",
      body: "Need blood? Post a request in the Request Blood tab. Once a donor responds, chat with them directly to arrange the donation. Please remember to at least cover their travel fare — it means a lot.",
    },
  ];
  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
      <div className="bg-card rounded-2xl w-full max-w-sm shadow-2xl border border-border overflow-hidden">
        <div className="bg-primary/5 px-6 pt-8 pb-6 text-center">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            {current.icon}
          </div>
          <h2 className="font-display font-bold text-xl text-foreground">{current.title}</h2>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm text-muted-foreground leading-relaxed text-center">{current.body}</p>
          <div className="flex justify-center gap-1.5 mt-5 mb-5">
            {steps.map((_, i) => (
              <div key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-primary" : "w-1.5 bg-border"}`} />
            ))}
          </div>
          <button onClick={() => { if (isLast) onDone(); else setStep(s => s + 1); }}
            className="w-full bg-primary text-primary-foreground py-3 rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
            {isLast ? <><Sparkles className="w-4 h-4" /> Get Started</> : <>Next <ChevronRight className="w-4 h-4" /></>}
          </button>
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} className="w-full text-center text-xs text-muted-foreground mt-2 py-1 hover:text-foreground transition-colors">Back</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────
function DashboardScreen({ profile, onLogout }: { profile: Profile; onLogout: () => void }) {
  const [tab, setTab] = useState<"donate" | "request" | "activity" | "history" | "messages">("donate");
  // Donate-side state (this user acting as donor)
  const [compatibleRequests, setCompatibleRequests] = useState<BloodRequest[]>([]);
  const [myDonationResponses, setMyDonationResponses] = useState<DonorResponse[]>([]);
  const [respondedIds, setRespondedIds] = useState<Set<string>>(new Set());
  const [successId, setSuccessId] = useState<string | null>(null);
  // Request-side state (this user acting as taker)
  const [myRequests, setMyRequests] = useState<BloodRequest[]>([]);
  const [requestResponses, setRequestResponses] = useState<DonorResponse[]>([]);
  const [responseBadge, setResponseBadge] = useState(0);

  const [loading, setLoading] = useState(false);
  const [respondTarget, setRespondTarget] = useState<BloodRequest | null>(null);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const prevResponseCount = useRef(0);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [fulfillTarget, setFulfillTarget] = useState<{ response: DonorResponse; requestId: string } | null>(null);
  const [fulfilledResponseIds, setFulfilledResponseIds] = useState<Set<string>>(new Set());
  const [cancelTarget, setCancelTarget] = useState<BloodRequest | null>(null);
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [showDonationWarning, setShowDonationWarning] = useState(false);
  const [pendingRespondTarget, setPendingRespondTarget] = useState<BloodRequest | null>(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [localProfile, setLocalProfile] = useState(profile);
  const [chatTarget, setChatTarget] = useState<{ requestId: string; otherName: string } | null>(null);
  const [ratingTarget, setRatingTarget] = useState<{ donorId: string; donorName: string; requestId: string } | null>(null);
  const [ratedRequestIds, setRatedRequestIds] = useState<Set<string>>(new Set());
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem(`lifelink_onboarded_${profile.id}`));
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [messageBadge, setMessageBadge] = useState(0);
  const [donorProfiles, setDonorProfiles] = useState<Map<string, Profile>>(new Map());
  const [historyRatings, setHistoryRatings] = useState<Map<string, DonorRating[]>>(new Map());
  const [userCoords, setUserCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [requestDistances, setRequestDistances] = useState<Map<string, number>>(new Map());

  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      const [reqRes, donorRes, takerRes] = await Promise.all([
        api("/requests"),
        api(`/donors/${profile.id}/responses`),
        api(`/takers/${profile.id}/requests`),
      ]);

      // Donate side
      const all: BloodRequest[] = reqRes.requests ?? [];
      setCompatibleRequests(all.filter(r =>
        r.status === "open" && isCompatible(profile.bloodGroup, r.bloodGroup) && r.takerId !== profile.id
      ));
      const donorResponses: DonorResponse[] = (donorRes.responses ?? []).map((r: DonorResponse) => {
        if (r.takerName) return r;
        const req = all.find(req => req.id === r.requestId);
        return req ? { ...r, takerName: req.patientName || req.takerName } : r;
      });
      setMyDonationResponses(donorResponses);
      setRespondedIds(new Set(donorResponses.map(r => r.requestId)));

      // Request side
      const myReqs: BloodRequest[] = takerRes.requests ?? [];
      setMyRequests(myReqs);
      if (myReqs.length > 0) {
        const allRes = await Promise.all(myReqs.map(r => api(`/requests/${r.id}/responses`).then(d => d.responses ?? [])));
        const flat = allRes.flat() as DonorResponse[];
        setRequestResponses(flat);
        setResponseBadge(flat.length);
      }
    } finally { setLoading(false); }
  }, [profile.id, profile.bloodGroup]);

  useEffect(() => {
    if (tab !== "profile" && tab !== "history") loadAllData();
  }, [tab, loadAllData]);

  // Load donor profiles (for ratings) whenever we have request responses
  useEffect(() => {
    if (requestResponses.length === 0) return;
    const uniqueDonorIds = [...new Set(requestResponses.map(r => r.donorId))];
    Promise.all(uniqueDonorIds.map(id => api(`/profiles/${id}`).then(d => d.profile).catch(() => null)))
      .then(profiles => {
        const map = new Map<string, Profile>();
        profiles.forEach(p => { if (p) map.set(p.id, p); });
        setDonorProfiles(map);
      });
  }, [requestResponses]);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "granted") setNotifEnabled(true);
  }, []);

  // Acquire user geolocation once on mount
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      pos => setUserCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => { /* denied or unavailable — silent */ },
      { timeout: 8000 }
    );
  }, []);

  // Compute distances for visible requests whenever coords or requests change
  useEffect(() => {
    if (!userCoords || compatibleRequests.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates = new Map<string, number>(requestDistances);
      for (const req of compatibleRequests) {
        if (cancelled) break;
        if (updates.has(req.id)) continue;
        const coords = await geocodeCity(req.city);
        if (coords) updates.set(req.id, haversineKm(userCoords.lat, userCoords.lon, coords.lat, coords.lon));
        await new Promise(r => setTimeout(r, 300)); // respect Nominatim 1 req/s limit
      }
      if (!cancelled) setRequestDistances(new Map(updates));
    })();
    return () => { cancelled = true; };
  }, [userCoords, compatibleRequests.map(r => r.id).join(",")]);

  // Poll every 30s for new requests and response counts
  useEffect(() => {
    const poll = async () => {
      try {
        const [{ requests: all }, { count }] = await Promise.all([
          api("/requests"),
          api(`/takers/${profile.id}/response-count`),
        ]);
        const compatible = (all as BloodRequest[]).filter(
          r => r.status === "open" && isCompatible(profile.bloodGroup, r.bloodGroup) && r.takerId !== profile.id
        );
        setCompatibleRequests(compatible);
        if (count > prevResponseCount.current && prevResponseCount.current > 0) {
          const diff = count - prevResponseCount.current;
          setResponseBadge(count);
          showBrowserNotification("🩸 New donor response!", `${diff} new donor${diff > 1 ? "s have" : " has"} responded to your blood request.`);
        } else {
          setResponseBadge(count);
        }
        if (compatible.length > prevResponseCount.current && prevResponseCount.current > 0) {
          showBrowserNotification("🩸 New blood request!", `A ${compatible[0]?.bloodGroup} blood request in ${compatible[0]?.city} needs help.`);
        }
        prevResponseCount.current = count;
      } catch { /* silent */ }
    };
    poll();
    const interval = setInterval(poll, 30_000);
    return () => clearInterval(interval);
  }, [profile.id, profile.bloodGroup]);

  const handleRespondSuccess = (requestId: string) => {
    setRespondTarget(null);
    setRespondedIds(prev => new Set([...prev, requestId]));
    setSuccessId(requestId);
    setTimeout(() => setSuccessId(null), 4000);
    loadAllData();
  };

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { records } = await api(`/history/${profile.id}`);
      const recs: HistoryRecord[] = records ?? [];
      setHistory(recs);
      setFulfilledResponseIds(new Set(recs.map((r: HistoryRecord) => r.responseId)));
      // Load ratings for each unique donor in history
      const uniqueDonorIds = [...new Set(recs.map(r => r.donorId))];
      const ratingResults = await Promise.all(
        uniqueDonorIds.map(id => api(`/ratings/${id}`).then(d => ({ id, ratings: d.ratings ?? [] })).catch(() => ({ id, ratings: [] })))
      );
      const map = new Map<string, DonorRating[]>();
      ratingResults.forEach(({ id, ratings }) => map.set(id, ratings));
      setHistoryRatings(map);
    } finally { setHistoryLoading(false); }
  }, [profile.id]);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]);

  const loadConversations = useCallback(async () => {
    setConvLoading(true);
    try {
      // Gather all requestIds this user is part of
      const [donorRes, takerRes] = await Promise.all([
        api(`/donors/${profile.id}/responses`),
        api(`/takers/${profile.id}/requests`),
      ]);
      const donorResponses: DonorResponse[] = donorRes.responses ?? [];
      const myReqs: BloodRequest[] = takerRes.requests ?? [];

      // convMap: requestId → { otherName, bloodGroup }
      const convMap = new Map<string, { otherName: string; bloodGroup: BloodGroup }>();

      // As DONOR: fetch the actual request to get the taker's real name (reliable for old + new records)
      await Promise.all(donorResponses.map(async r => {
        if (convMap.has(r.requestId)) return;
        let takerName = r.takerName;
        if (!takerName) {
          const req = await api(`/requests/${r.requestId}`).catch(() => null);
          takerName = req?.request?.patientName || req?.request?.takerName || "Recipient";
        }
        convMap.set(r.requestId, { otherName: takerName, bloodGroup: r.donorBloodGroup });
      }));

      // As TAKER: each donor who responded — use the donor's name from the response
      const takerResponsesAll: DonorResponse[] = myReqs.length > 0
        ? (await Promise.all(myReqs.map(r => api(`/requests/${r.id}/responses`).then(d => (d.responses ?? []) as DonorResponse[])))).flat()
        : [];
      takerResponsesAll.forEach(r => {
        if (!convMap.has(r.requestId)) convMap.set(r.requestId, { otherName: r.donorName, bloodGroup: r.donorBloodGroup });
      });

      if (convMap.size === 0) { setConversations([]); setMessageBadge(0); return; }

      // Fetch chat messages for each conversation
      const results = await Promise.all(
        Array.from(convMap.entries()).map(async ([requestId, meta]) => {
          const { messages: msgs } = await api(`/chat/${requestId}`).catch(() => ({ messages: [] }));
          const allMsgs: ChatMessage[] = msgs ?? [];
          const lastSeen = getLastSeen(profile.id, requestId);
          const unread = allMsgs.filter(m => m.senderId !== profile.id && new Date(m.createdAt) > lastSeen).length;
          const lastMessage = allMsgs[allMsgs.length - 1];
          return { requestId, ...meta, lastMessage, unreadCount: unread } as Conversation;
        })
      );

      results.sort((a, b) => {
        const at = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
        const bt = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
        return bt - at;
      });

      setConversations(results);
      setMessageBadge(results.reduce((sum, c) => sum + c.unreadCount, 0));
    } finally { setConvLoading(false); }
  }, [profile.id]);

  useEffect(() => {
    if (tab === "messages") loadConversations();
  }, [tab, loadConversations]);

  // Refresh message badge every 30s regardless of active tab
  useEffect(() => {
    const t = setInterval(() => loadConversations(), 30_000);
    loadConversations();
    return () => clearInterval(t);
  }, [loadConversations]);

  const [profileOpen, setProfileOpen] = useState(false);

  const tabs = [
    { key: "donate",    label: "Donate",    badge: compatibleRequests.length },
    { key: "request",   label: "Request",   badge: myRequests.length },
    { key: "messages",  label: "Messages",  badge: messageBadge },
    { key: "activity",  label: "Activity",  badge: responseBadge },
    { key: "history",   label: "History",   badge: history.length },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-5 py-3.5 border-b border-border bg-white/80 backdrop-blur-sm sticky top-0 z-20 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center shadow-sm shadow-primary/30">
            <BloodDropIcon className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-bold text-foreground tracking-tight">LifeLink</span>
        </div>
        <div className="flex items-center gap-2">
          {!notifEnabled && "Notification" in window && Notification.permission !== "denied" && (
            <button onClick={async () => { const granted = await requestNotificationPermission(); setNotifEnabled(granted); }}
              className="text-xs bg-accent text-accent-foreground border border-primary/20 px-2.5 py-1.5 rounded-lg hover:bg-primary hover:text-primary-foreground transition-colors font-semibold flex items-center gap-1.5">
              🔔 Alerts
            </button>
          )}
          {notifEnabled && (
            <span className="text-xs text-green-600 font-semibold hidden sm:flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Alerts on
            </span>
          )}
          <button onClick={async () => {
            setProfileOpen(true);
            try {
              const data = await api(`/profiles/${localProfile.id}`);
              if (data.profile) setLocalProfile(data.profile);
            } catch { /* silent */ }
          }}
            className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-display font-bold text-sm hover:opacity-90 transition-opacity ring-2 ring-primary/20 shadow-md shadow-primary/20">
            {localProfile.firstName[0]}{localProfile.lastName[0]}
          </button>
        </div>
      </header>

      {/* Profile drawer */}
      {profileOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setProfileOpen(false)} />
          <div className="relative bg-card w-full max-w-sm h-full flex flex-col shadow-2xl overflow-hidden">
            {/* Drawer header */}
            <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-card shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-display font-bold">
                  {localProfile.firstName[0]}{localProfile.lastName[0]}
                </div>
                <div>
                  <p className="font-display font-bold text-foreground leading-tight">{localProfile.firstName} {localProfile.lastName}</p>
                  <p className="text-xs text-muted-foreground">{localProfile.bloodGroup} · Donor &amp; Recipient</p>
                </div>
              </div>
              <button onClick={() => setProfileOpen(false)} className="text-muted-foreground hover:text-foreground p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
              {[
                ["Full Name", `${localProfile.firstName} ${localProfile.lastName}`],
                ["Date of Birth", formatDate(localProfile.dob)],
                ["Gender", localProfile.gender],
                ["Blood Group", localProfile.bloodGroup],
                ["Email", localProfile.email],
                ["Phone", localProfile.phone],
                localProfile.altPhone ? ["Alt. Phone", localProfile.altPhone] : null,
                ["Address", `${localProfile.address}, ${localProfile.city}, ${localProfile.state}`],
                ["Donations Made", localProfile.donationCount ? `${localProfile.donationCount} donation${localProfile.donationCount !== 1 ? "s" : ""} · Last: ${formatDate(localProfile.lastDonationDate!)}` : "First-time donor"],
                localProfile.availableTodonate !== undefined ? ["Donor Status", localProfile.availableTodonate ? "Available" : "Not available"] : null,
                localProfile.medicalConditions ? ["Medical Conditions", localProfile.medicalConditions] : null,
              ].filter(Boolean).map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-4 py-2.5 border-b border-border last:border-0 text-sm">
                  <span className="text-muted-foreground shrink-0 w-32">{k}</span>
                  <span className="text-foreground font-medium text-right">{v}</span>
                </div>
              ))}
              {/* Rating row — custom render with stars */}
              <div className="flex items-center justify-between gap-4 py-2.5 border-t border-border text-sm">
                <span className="text-muted-foreground shrink-0 w-32">Donor Rating</span>
                <div className="text-right">
                  {localProfile.ratingAvg && localProfile.ratingCount
                    ? <StarDisplay avg={localProfile.ratingAvg} count={localProfile.ratingCount} />
                    : <span className="text-foreground/50 text-xs">No ratings yet</span>}
                </div>
              </div>
            </div>

            {/* Drawer actions */}
            <div className="px-5 py-4 border-t border-border bg-card shrink-0 space-y-2">
              <button onClick={() => { setProfileOpen(false); setShowEditProfile(true); }}
                className="w-full flex items-center justify-between px-4 py-3 rounded-md bg-secondary hover:bg-muted transition-colors text-sm font-medium">
                Edit Profile Info <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
              <button onClick={() => { setProfileOpen(false); setShowChangePassword(true); }}
                className="w-full flex items-center justify-between px-4 py-3 rounded-md bg-secondary hover:bg-muted transition-colors text-sm font-medium">
                Change Password <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
              <button onClick={onLogout}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/5 transition-colors text-sm font-semibold">
                <LogIn className="w-4 h-4 rotate-180" /> Log out
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        {/* Stats banner */}
        <div className="bg-card border border-border rounded-xl p-4 mb-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Award className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your Impact</span>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {[
              {
                icon: <Heart className="w-4 h-4" />,
                label: "Blood Group",
                val: localProfile.bloodGroup,
                highlight: true,
              },
              {
                icon: <Droplets className="w-4 h-4" />,
                label: "Donations",
                val: localProfile.donationCount ?? 0,
              },
              {
                icon: <Sparkles className="w-4 h-4" />,
                label: "Lives Helped",
                val: localProfile.donationCount ?? 0,
              },
              {
                icon: <Calendar className="w-4 h-4" />,
                label: "Last Donated",
                val: localProfile.lastDonationDate ? `${Math.floor((Date.now() - new Date(localProfile.lastDonationDate).getTime()) / 86400000)}d ago` : "Never",
              },
            ].map(s => (
              <div key={s.label} className={`rounded-2xl p-3.5 text-center shadow-sm ${s.highlight ? "bg-primary text-primary-foreground" : "bg-white border border-border"}`}>
                <div className={`w-7 h-7 rounded-xl flex items-center justify-center mx-auto mb-2 ${s.highlight ? "bg-white/20" : "bg-primary/10 text-primary"}`}>{s.icon}</div>
                <div className={`font-display font-black text-base ${s.highlight ? "text-white" : "text-foreground"}`}>{s.val}</div>
                <div className={`text-[10px] mt-0.5 leading-tight font-medium ${s.highlight ? "text-white/80" : "text-muted-foreground"}`}>{s.label}</div>
              </div>
            ))}
          </div>
          {(localProfile.donationCount ?? 0) === 0 && (
            <p className="text-xs text-muted-foreground text-center mt-3 border-t border-border pt-3">
              You haven&apos;t donated yet — respond to a request to make your first life-saving impact!
            </p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 overflow-x-auto bg-muted/60 rounded-xl p-1">
          {tabs.map(t => (
            <button key={t.key} onClick={() => {
              setTab(t.key as any);
              if (t.key === "activity") setResponseBadge(0);
              if (t.key === "messages") setMessageBadge(0);
            }}
              className={`flex-1 px-2 py-2 text-xs font-bold transition-all rounded-lg flex items-center justify-center gap-1.5 whitespace-nowrap min-w-0 ${tab === t.key ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {t.label}
              {t.badge > 0 && (
                <span className={`inline-flex items-center justify-center w-4.5 h-4.5 rounded-full text-[9px] font-black leading-none px-1 ${tab === t.key ? "bg-primary text-white" : "bg-primary/80 text-white"}`}>
                  {t.badge > 99 ? "99+" : t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Donate Blood tab */}
        {tab === "donate" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display font-bold text-foreground">Compatible Blood Requests</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Matching your <span className="font-semibold text-primary">{profile.bloodGroup}</span> blood group
                </p>
              </div>
              <button onClick={loadAllData} className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-secondary transition-colors">
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {/* Eligibility banner */}
            {(() => {
              const { eligible, daysLeft, daysSinceLast } = donorEligibility(localProfile.lastDonationDate);
              if (eligible || daysSinceLast === Infinity) return null;
              return (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 mb-4 flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">{daysLeft} day{daysLeft !== 1 ? "s" : ""} until recommended donation window</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Last donation was {daysSinceLast} day{daysSinceLast !== 1 ? "s" : ""} ago. WHO recommends waiting {DONATION_WAIT_DAYS} days between donations.
                    </p>
                  </div>
                </div>
              );
            })()}

            {loading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground"><Spinner /><span className="text-sm">Loading…</span></div>
            ) : compatibleRequests.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Droplets className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No compatible requests right now.</p>
                <p className="text-xs mt-1 opacity-70">Check back soon — requests update in real time.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {compatibleRequests.map(req => {
                  const uc = URGENCY_COLORS[req.urgency];
                  const responded = respondedIds.has(req.id);
                  const isSuccess = successId === req.id;
                  return (
                    <div key={req.id} className={`bg-white border-2 rounded-2xl p-4 transition-all shadow-sm ${isSuccess ? "border-green-300 bg-green-50/50" : "border-border hover:border-primary/25 hover:shadow-md"}`}>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-display font-black text-base border-2 shadow-sm ${uc.card}`}>
                            <span className="text-primary">{req.bloodGroup}</span>
                          </div>
                          <div>
                            <p className="font-bold text-foreground text-sm">{req.patientName || req.takerName}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{req.hospital}</p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border flex items-center gap-1.5 ${uc.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${uc.dot} ${req.urgency === "Critical" ? "animate-pulse" : ""}`} />
                            {req.urgency}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{timeAgo(req.createdAt)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3 flex-wrap">
                        <span className="flex items-center gap-1.5 bg-muted rounded-full px-2.5 py-1"><MapPin className="w-3 h-3" />{req.city}</span>
                        {requestDistances.has(req.id) && (
                          <span className="flex items-center gap-1.5 bg-primary/10 text-primary font-semibold rounded-full px-2.5 py-1">
                            ~{requestDistances.get(req.id)!.toFixed(0)} km
                          </span>
                        )}
                        <span className="flex items-center gap-1.5 bg-muted rounded-full px-2.5 py-1"><Droplets className="w-3 h-3" />{req.unitsRequired} unit{req.unitsRequired > 1 ? "s" : ""}</span>
                        <span className="flex items-center gap-1.5 bg-muted rounded-full px-2.5 py-1"><MessageCircle className="w-3 h-3" />{req.responseCount}</span>
                      </div>
                      {req.reason && <p className="text-xs text-muted-foreground mb-3 line-clamp-2 leading-relaxed">{req.reason}</p>}
                      <a href={mapsDirectionsUrl(req.hospital, req.city)} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-primary hover:underline mb-3 w-fit font-semibold">
                        <MapPin className="w-3.5 h-3.5" /> Directions to {req.hospital}
                      </a>
                      <div className="border-t border-border pt-3">
                        {isSuccess ? (
                          <div className="flex items-center gap-2 text-green-700 text-sm font-bold">
                            <CheckCircle className="w-4 h-4" /> Response sent! They can now see your contact info.
                          </div>
                        ) : responded ? (
                          <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium">
                            <CheckCircle className="w-4 h-4 text-green-600" /> You already responded.
                          </div>
                        ) : (
                          <button onClick={() => {
                            const { eligible } = donorEligibility(localProfile.lastDonationDate);
                            if (!eligible) { setPendingRespondTarget(req); setShowDonationWarning(true); }
                            else setRespondTarget(req);
                          }}
                            className="w-full bg-primary text-primary-foreground py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-primary/90 active:scale-[0.98] transition-all shadow-sm shadow-primary/20">
                            <Heart className="w-4 h-4" /> I can help — Respond
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Request Blood tab */}
        {tab === "request" && (
          <div>
            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
              <Heart className="w-4 h-4 text-amber-600 shrink-0" />
              <p className="text-xs text-amber-800 font-medium leading-relaxed">
                <span className="font-bold uppercase tracking-wide">We encourage you</span> to at least give the donor their travel fare or transport fee as a gesture of gratitude. Every donor gives their time and effort to help you.
              </p>
            </div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display font-bold text-foreground">Your Blood Requests</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Post requests when you need blood</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowNewRequest(true)}
                  className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-semibold px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors">
                  <Plus className="w-3.5 h-3.5" /> New Request
                </button>
                <button onClick={loadAllData} className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-secondary transition-colors">
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground"><Spinner /><span className="text-sm">Loading…</span></div>
            ) : myRequests.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Droplets className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No blood requests posted yet.</p>
                <p className="text-xs mt-1 opacity-70">Tap "+ New Request" to ask the community for help.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {myRequests.map(req => {
                  const uc = URGENCY_COLORS[req.urgency];
                  return (
                    <div key={req.id} className="bg-card border border-border rounded-lg p-4 hover:border-primary/30 transition-all">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-md flex items-center justify-center font-display font-extrabold text-sm ${uc.card} border`}>
                            <span className="text-primary">{req.bloodGroup}</span>
                          </div>
                          <div>
                            <p className="font-semibold text-foreground text-sm">{req.patientName || req.takerName}</p>
                            <p className="text-xs text-muted-foreground">{req.hospital || "—"} · {req.city}</p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 ${uc.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${uc.dot} ${req.urgency === "Critical" ? "animate-pulse" : ""}`} />
                            {req.urgency}
                          </span>
                          <span className="text-xs text-muted-foreground">{timeAgo(req.createdAt)}</span>
                        </div>
                      </div>
                      {req.reason && <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{req.reason}</p>}
                      <div className="border-t border-border pt-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${req.status === "open" ? "bg-blue-50 text-blue-700 border-blue-200" : req.status === "closed" ? "bg-gray-100 text-gray-500 border-gray-200" : "bg-green-50 text-green-700 border-green-200"}`}>
                            {req.status === "open" ? "Active" : req.status === "closed" ? "Cancelled" : "Fulfilled"}
                          </span>
                          <span className="text-xs text-muted-foreground">{req.responseCount} donor{req.responseCount !== 1 ? "s" : ""} responded</span>
                        </div>
                        {req.status === "open" && (
                          <button
                            onClick={() => setCancelTarget(req)}
                            className="text-xs text-destructive hover:text-destructive/80 font-medium flex items-center gap-1 transition-colors"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Cancel Request
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Activity tab — two sections */}
        {tab === "activity" && (
          <div className="space-y-8">
            <button onClick={loadAllData} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground ml-auto">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>

            {/* Section A: My donation activity */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Heart className="w-4 h-4 text-primary" />
                <h3 className="font-display font-bold text-foreground text-sm">My Donation Responses</h3>
                <span className="text-xs text-muted-foreground">({myDonationResponses.length})</span>
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground"><Spinner /><span className="text-sm">Loading…</span></div>
              ) : myDonationResponses.length === 0 ? (
                <div className="bg-card border border-border rounded-lg p-6 text-center text-muted-foreground">
                  <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No donations yet. Go to Donate Blood to start helping.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {myDonationResponses.map(r => (
                    <div key={r.id} className="bg-card border border-border rounded-lg p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-md bg-accent border border-primary/20 flex items-center justify-center font-display font-extrabold text-xs text-primary">
                            {r.donorBloodGroup}
                          </div>
                          <div>
                            <p className="font-semibold text-foreground text-sm">Offered to donate to {r.takerName ?? "a recipient"}</p>
                            <p className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</p>
                          </div>
                        </div>
                      </div>
                      {r.message && <p className="text-xs text-foreground/60 italic bg-accent/50 rounded px-3 py-2 mb-3">"{r.message}"</p>}
                      <button
                        onClick={() => { markChatRead(profile.id, r.requestId); setChatTarget({ requestId: r.requestId, otherName: r.takerName || "Recipient" }); }}
                        className="w-full flex items-center justify-center gap-2 border border-border py-2 rounded-md text-xs font-medium hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground mt-2">
                        <MessageCircle className="w-3.5 h-3.5" /> Chat with {r.takerName || "Recipient"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Section B: Donors who responded to my requests */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-primary" />
                <h3 className="font-display font-bold text-foreground text-sm">Donors Responding to My Requests</h3>
                <span className="text-xs text-muted-foreground">({requestResponses.length})</span>
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground"><Spinner /><span className="text-sm">Loading…</span></div>
              ) : requestResponses.length === 0 ? (
                <div className="bg-card border border-border rounded-lg p-6 text-center text-muted-foreground">
                  <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No donors have responded to your requests yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {requestResponses.map(r => {
                    const alreadyFulfilled = fulfilledResponseIds.has(r.id);
                    const parentRequest = myRequests.find(req => req.id === r.requestId);
                    return (
                      <div key={r.id} className="bg-card border border-border rounded-lg p-4 hover:border-primary/30 transition-colors">
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-md bg-accent border border-primary/20 flex items-center justify-center font-display font-extrabold text-sm text-primary">
                              {r.donorBloodGroup}
                            </div>
                            <div>
                              <p className="font-semibold text-foreground text-sm">{r.donorName}</p>
                              <p className="text-xs text-muted-foreground">{r.donorCity}</p>
                              {(() => { const dp = donorProfiles.get(r.donorId); return dp?.ratingAvg && dp?.ratingCount ? <StarDisplay avg={dp.ratingAvg} count={dp.ratingCount} size="xs" /> : null; })()}
                            </div>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">{timeAgo(r.createdAt)}</span>
                        </div>
                        <div className="bg-secondary rounded-md p-3 space-y-1.5 mb-3">
                          <div className="flex items-center gap-2 text-sm text-foreground">
                            <Phone className="w-3.5 h-3.5 text-primary/60" />
                            <a href={`tel:${r.donorPhone}`} className="hover:text-primary transition-colors font-medium">{r.donorPhone}</a>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-foreground">
                            <Mail className="w-3.5 h-3.5 text-primary/60" />
                            <a href={`mailto:${r.donorEmail}`} className="hover:text-primary transition-colors font-medium">{r.donorEmail}</a>
                          </div>
                        </div>
                        {r.message && <p className="text-xs text-foreground/60 italic bg-accent/50 rounded px-3 py-2 mb-3">"{r.message}"</p>}
                        <div className="flex gap-2 mb-2">
                          <button
                            onClick={() => { markChatRead(profile.id, r.requestId); setChatTarget({ requestId: r.requestId, otherName: r.donorName }); }}
                            className="flex-1 flex items-center justify-center gap-1.5 border border-border py-2 rounded-md text-xs font-medium hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                            <MessageCircle className="w-3.5 h-3.5" /> Chat
                          </button>
                          {!ratedRequestIds.has(r.requestId) && alreadyFulfilled && (
                            <button
                              onClick={() => setRatingTarget({ donorId: r.donorId, donorName: r.donorName, requestId: r.requestId })}
                              className="flex-1 flex items-center justify-center gap-1.5 border border-amber-300 bg-amber-50 text-amber-700 py-2 rounded-md text-xs font-medium hover:bg-amber-100 transition-colors">
                              <Star className="w-3.5 h-3.5" /> Rate Donor
                            </button>
                          )}
                        </div>
                        {parentRequest && (
                          <a href={mapsDirectionsUrl(parentRequest.hospital, parentRequest.city)} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-xs text-primary hover:underline mb-2 w-fit">
                            <MapPin className="w-3.5 h-3.5" /> Get Directions to {parentRequest.hospital}
                          </a>
                        )}
                        {parentRequest && parentRequest.status !== "fulfilled" && !alreadyFulfilled ? (
                          <button
                            onClick={() => setFulfillTarget({ response: r, requestId: r.requestId })}
                            className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-2 rounded-md text-sm font-semibold hover:bg-green-700 transition-colors">
                            <CheckCircle className="w-4 h-4" /> Mark Donation as Complete
                          </button>
                        ) : alreadyFulfilled ? (
                          <div className="flex items-center gap-2 text-green-700 text-xs font-semibold bg-green-50 border border-green-200 rounded-md px-3 py-2">
                            <CheckCircle className="w-3.5 h-3.5" /> Donation confirmed complete
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* Messages tab */}
        {tab === "messages" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display font-bold text-foreground">Messages</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Conversations with donors and recipients</p>
              </div>
              <button onClick={loadConversations} className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-secondary transition-colors">
                <RefreshCw className={`w-4 h-4 ${convLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
            {convLoading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground"><Spinner /><span className="text-sm">Loading…</span></div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No conversations yet.</p>
                <p className="text-xs mt-1 opacity-70">Respond to a blood request or post one to start chatting.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {conversations.map(conv => (
                  <button
                    key={conv.requestId}
                    onClick={() => {
                      markChatRead(profile.id, conv.requestId);
                      setChatTarget({ requestId: conv.requestId, otherName: conv.otherName });
                      setConversations(prev => prev.map(c => c.requestId === conv.requestId ? { ...c, unreadCount: 0 } : c));
                      setMessageBadge(prev => Math.max(0, prev - conv.unreadCount));
                    }}
                    className={`w-full text-left flex items-center gap-3 p-4 rounded-lg border transition-all hover:border-primary/40 ${conv.unreadCount > 0 ? "bg-primary/5 border-primary/30" : "bg-card border-border"}`}>
                    {/* Avatar */}
                    <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center font-display font-bold text-sm shrink-0 relative">
                      {conv.otherName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                      {conv.unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                          {conv.unreadCount > 9 ? "9+" : conv.unreadCount}
                        </span>
                      )}
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-sm truncate ${conv.unreadCount > 0 ? "font-bold text-foreground" : "font-semibold text-foreground"}`}>
                          {conv.otherName}
                        </p>
                        {conv.lastMessage && (
                          <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(conv.lastMessage.createdAt)}</span>
                        )}
                      </div>
                      <p className={`text-xs truncate mt-0.5 ${conv.unreadCount > 0 ? "text-foreground/80 font-medium" : "text-muted-foreground"}`}>
                        {conv.lastMessage
                          ? (conv.lastMessage.senderId === profile.id ? `You: ${conv.lastMessage.text}` : conv.lastMessage.text)
                          : "No messages yet — say hello!"}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* History tab */}
        {tab === "history" && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-display font-bold text-foreground">Donation History</h3>
                <p className="text-xs text-muted-foreground mt-0.5">All confirmed donations you were part of.</p>
              </div>
              <button onClick={loadHistory} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors">
                <RefreshCw className={`w-4 h-4 ${historyLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
            {historyLoading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground"><Spinner /><span className="text-sm">Loading history…</span></div>
            ) : history.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">No history yet.</p>
                <p className="text-xs mt-1 opacity-70">Completed donations will appear here once confirmed.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map(rec => {
                  const asDonor = rec.donorId === profile.id;
                  return (
                    <div key={rec.id} className="bg-card border border-green-200 rounded-lg overflow-hidden">
                      <div className="bg-green-50 px-4 py-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          <span className="text-xs font-semibold text-green-700">
                            {asDonor ? "You donated" : "You received"}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">{formatDate(rec.completedAt)}</span>
                      </div>
                      <div className="p-4">
                        <div className="flex items-start gap-4 mb-4">
                          <div className="w-12 h-12 rounded-md bg-accent border border-primary/20 flex items-center justify-center font-display font-extrabold text-lg text-primary shrink-0">
                            {rec.bloodGroup}
                          </div>
                          <div className="flex-1">
                            {asDonor ? (
                              <>
                                <p className="font-semibold text-foreground">Donated to <span className="text-primary">{rec.takerName}</span></p>
                                <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5"><MapPin className="w-3 h-3" />{rec.hospital}, {rec.city}</p>
                              </>
                            ) : (
                              <>
                                <p className="font-semibold text-foreground">Received from <span className="text-primary">{rec.donorName}</span></p>
                                <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5"><MapPin className="w-3 h-3" />{rec.hospital}, {rec.city}</p>
                              </>
                            )}
                          </div>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0 ${URGENCY_COLORS[rec.urgency].badge}`}>{rec.urgency}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                          <div className="bg-secondary rounded-md p-3">
                            <p className="text-xs text-muted-foreground mb-1">Donor</p>
                            <p className="font-semibold text-foreground">{rec.donorName}</p>
                            <p className="text-xs text-muted-foreground">{rec.donorBloodGroup} · {rec.donorCity}</p>
                            <a href={`tel:${rec.donorPhone}`} className="text-xs text-primary hover:underline mt-0.5 block">{rec.donorPhone}</a>
                          </div>
                          <div className="bg-secondary rounded-md p-3">
                            <p className="text-xs text-muted-foreground mb-1">Request Details</p>
                            <p className="font-semibold text-foreground">{rec.unitsRequired} unit{rec.unitsRequired > 1 ? "s" : ""} of {rec.bloodGroup}</p>
                            <p className="text-xs text-muted-foreground">Requested {formatDate(rec.requestCreatedAt)}</p>
                            <p className="text-xs text-muted-foreground">Fulfilled {formatDate(rec.completedAt)}</p>
                          </div>
                        </div>
                        {rec.notes && (
                          <div className="bg-accent/60 rounded-md px-3 py-2 text-xs text-foreground/70 italic flex gap-2 mb-3">
                            <MessageCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary/50" />
                            "{rec.notes}"
                          </div>
                        )}
                        {/* Rating section */}
                        {(() => {
                          const ratingsForDonor = historyRatings.get(rec.donorId) ?? [];
                          const ratingForThisRequest = ratingsForDonor.find(r => r.requestId === rec.requestId);
                          if (!ratingForThisRequest) return null;
                          return (
                            <div className="border border-amber-200 bg-amber-50 rounded-md px-3 py-2.5">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-semibold text-amber-800">
                                  {asDonor ? "Recipient's rating for you" : "Your rating for this donor"}
                                </span>
                                <StarDisplay avg={ratingForThisRequest.stars} count={1} size="xs" />
                              </div>
                              {ratingForThisRequest.note && (
                                <p className="text-xs text-amber-700 italic">"{ratingForThisRequest.note}"</p>
                              )}
                              <p className="text-[10px] text-amber-600 mt-1">— {ratingForThisRequest.takerName}</p>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {respondTarget && (
        <RespondModal request={respondTarget} profile={profile}
          onClose={() => setRespondTarget(null)}
          onSuccess={() => handleRespondSuccess(respondTarget.id)} />
      )}

      {fulfillTarget && (
        <FulfillModal
          response={fulfillTarget.response}
          requestId={fulfillTarget.requestId}
          onClose={() => setFulfillTarget(null)}
          onSuccess={() => {
            const r = fulfillTarget.response;
            setFulfilledResponseIds(prev => new Set([...prev, r.id]));
            setFulfillTarget(null);
            loadAllData();
            loadHistory();
            // Prompt for rating after marking complete
            setRatingTarget({ donorId: r.donorId, donorName: r.donorName, requestId: r.requestId });
          }}
        />
      )}

      {ratingTarget && (
        <RatingModal
          donorId={ratingTarget.donorId}
          donorName={ratingTarget.donorName}
          requestId={ratingTarget.requestId}
          takerId={localProfile.id}
          takerName={`${localProfile.firstName} ${localProfile.lastName}`}
          onClose={() => setRatingTarget(null)}
          onSuccess={() => {
            setRatedRequestIds(prev => new Set([...prev, ratingTarget.requestId]));
            setRatingTarget(null);
          }}
        />
      )}

      {chatTarget && (
        <ChatModal
          requestId={chatTarget.requestId}
          currentUserId={localProfile.id}
          currentUserName={`${localProfile.firstName} ${localProfile.lastName}`}
          otherName={chatTarget.otherName}
          onClose={() => { setChatTarget(null); loadConversations(); }}
        />
      )}

      {showOnboarding && (
        <OnboardingModal
          profile={localProfile}
          onDone={() => {
            localStorage.setItem(`lifelink_onboarded_${profile.id}`, "1");
            setShowOnboarding(false);
          }}
        />
      )}

      {showDonationWarning && pendingRespondTarget && (
        <DonationWarningModal
          daysLeft={donorEligibility(localProfile.lastDonationDate).daysLeft}
          daysSinceLast={donorEligibility(localProfile.lastDonationDate).daysSinceLast}
          onCancel={() => { setShowDonationWarning(false); setPendingRespondTarget(null); }}
          onProceed={() => { setShowDonationWarning(false); setRespondTarget(pendingRespondTarget); setPendingRespondTarget(null); }}
        />
      )}

      {showNewRequest && (
        <NewRequestModal
          profile={localProfile}
          onClose={() => setShowNewRequest(false)}
          onSuccess={(req) => { setMyRequests(prev => [req, ...prev]); setShowNewRequest(false); }}
        />
      )}

      {cancelTarget && (
        <CancelRequestModal
          request={cancelTarget}
          profile={localProfile}
          onClose={() => setCancelTarget(null)}
          onSuccess={() => {
            setMyRequests(prev => prev.map(r => r.id === cancelTarget.id ? { ...r, status: "closed" } : r));
            setCancelTarget(null);
          }}
        />
      )}

      {showEditProfile && (
        <EditProfileModal
          profile={localProfile}
          onClose={() => setShowEditProfile(false)}
          onSuccess={(updated) => { setLocalProfile(updated); setShowEditProfile(false); }}
        />
      )}

      {showChangePassword && (
        <ChangePasswordModal
          profile={localProfile}
          onClose={() => setShowChangePassword(false)}
        />
      )}
    </div>
  );
}

// ── Admin Login ───────────────────────────────────────────────────────────
function AdminLoginScreen({ onBack, onSuccess }: { onBack: () => void; onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!username || !password) { setError("Enter username and password."); return; }
    setLoading(true); setError("");
    try {
      await api("/admin/login", { method: "POST", body: JSON.stringify({ username, password }) });
      onSuccess();
    } catch {
      setError("Invalid credentials.");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-6 py-5 border-b border-border flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-2">
          <BloodDropIcon className="w-5 h-5 text-primary" />
          <span className="font-display font-bold text-foreground">LifeLink Admin</span>
        </div>
        <div className="w-16" />
      </header>
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="w-12 h-12 rounded-xl bg-foreground flex items-center justify-center mb-6">
            <Shield className="w-5 h-5 text-background" />
          </div>
          <h1 className="font-display text-3xl font-extrabold text-foreground mb-1">Admin Access</h1>
          <p className="text-muted-foreground text-sm mb-8">Restricted to administrators only.</p>
          {error && <div className="mb-4"><ErrorBox message={error} /></div>}
          <div className="flex flex-col gap-4">
            <FormField label="Username" required>
              <TextInput placeholder="admin" value={username} onChange={setUsername} icon={<User className="w-4 h-4" />} />
            </FormField>
            <FormField label="Password" required>
              <TextInput type={showPw ? "text" : "password"} placeholder="••••••••" value={password} onChange={setPassword}
                icon={<Lock className="w-4 h-4" />}
                right={
                  <button type="button" onClick={() => setShowPw(p => !p)} className="text-muted-foreground hover:text-foreground">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                } />
            </FormField>
            <PrimaryBtn loading={loading} onClick={handleLogin}>
              <Shield className="w-4 h-4" /> Enter Admin Panel
            </PrimaryBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Admin Panel ───────────────────────────────────────────────────────────
interface AdminStats {
  totalUsers: number; totalDonors: number; totalTakers: number;
  openRequests: number; fulfilledRequests: number; totalRequests: number; totalResponses: number;
}

function AdminPanel({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<"overview" | "users" | "requests" | "responses">("overview");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<Profile[]>([]);
  const [requests, setRequests] = useState<BloodRequest[]>([]);
  const [responses, setResponses] = useState<DonorResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showCredentials, setShowCredentials] = useState(false);
  const [credForm, setCredForm] = useState({ currentPassword: "", newUsername: "", newPassword: "", confirmPassword: "" });
  const [credError, setCredError] = useState("");
  const [credDone, setCredDone] = useState(false);
  const [credLoading, setCredLoading] = useState(false);

  const loadStats = useCallback(async () => {
    const s = await api("/admin/stats");
    setStats(s);
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try { const d = await api("/admin/users"); setUsers(d.users ?? []); }
    finally { setLoading(false); }
  }, []);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try { const d = await api("/admin/requests"); setRequests(d.requests ?? []); }
    finally { setLoading(false); }
  }, []);

  const loadResponses = useCallback(async () => {
    setLoading(true);
    try { const d = await api("/admin/responses"); setResponses(d.responses ?? []); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  useEffect(() => {
    if (tab === "users") loadUsers();
    else if (tab === "requests") loadRequests();
    else if (tab === "responses") loadResponses();
  }, [tab, loadUsers, loadRequests, loadResponses]);

  const deleteUser = async (id: string) => {
    await api(`/admin/users/${id}`, { method: "DELETE" });
    setUsers(u => u.filter(x => x.id !== id));
    setConfirmDelete(null);
    loadStats();
  };

  const updateRequestStatus = async (id: string, status: string) => {
    await api(`/admin/requests/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
    setRequests(r => r.map(x => x.id === id ? { ...x, status: status as any } : x));
    loadStats();
  };

  const deleteRequest = async (id: string) => {
    await api(`/admin/requests/${id}`, { method: "DELETE" });
    setRequests(r => r.filter(x => x.id !== id));
    setConfirmDelete(null);
    loadStats();
  };

  const filteredUsers = users.filter(u =>
    `${u.firstName} ${u.lastName} ${u.email} ${u.bloodGroup} ${u.city}`.toLowerCase().includes(search.toLowerCase())
  );
  const filteredRequests = requests.filter(r =>
    `${r.takerName} ${r.bloodGroup} ${r.hospital} ${r.city} ${r.urgency}`.toLowerCase().includes(search.toLowerCase())
  );

  const tabs = [
    { key: "overview", label: "Overview", icon: <LayoutDashboard className="w-4 h-4" /> },
    { key: "users", label: "Users", icon: <Users className="w-4 h-4" /> },
    { key: "requests", label: "Requests", icon: <ClipboardList className="w-4 h-4" /> },
    { key: "responses", label: "Responses", icon: <MessageCircle className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 border-b border-border bg-foreground flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BloodDropIcon className="w-6 h-6 text-primary" />
          <div>
            <span className="font-display font-bold text-background tracking-tight">LifeLink</span>
            <span className="ml-2 text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded font-semibold">Admin</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setShowCredentials(true); setCredDone(false); setCredError(""); setCredForm({ currentPassword: "", newUsername: "", newPassword: "", confirmPassword: "" }); }}
            className="text-sm text-background/60 hover:text-background transition-colors font-medium flex items-center gap-1.5">
            <Lock className="w-4 h-4" /> Credentials
          </button>
          <button onClick={onLogout} className="text-sm text-background/60 hover:text-background transition-colors font-medium flex items-center gap-1.5">
            <LogIn className="w-4 h-4 rotate-180" /> Sign out
          </button>
        </div>
      </header>

      <div className="flex flex-col md:flex-row flex-1">
        {/* Sidebar */}
        <aside className="md:w-52 bg-card border-b md:border-b-0 md:border-r border-border flex md:flex-col flex-row md:py-6 px-3 md:px-4 gap-1 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key as any); setSearch(""); }}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-semibold transition-colors whitespace-nowrap ${tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </aside>

        {/* Main */}
        <main className="flex-1 p-6 overflow-auto">

          {/* Overview */}
          {tab === "overview" && (
            <div>
              <h2 className="font-display text-2xl font-bold text-foreground mb-6">Platform Overview</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                {[
                  { label: "Total Users", val: stats?.totalUsers ?? "—", color: "text-foreground" },
                  { label: "Donors", val: stats?.totalDonors ?? "—", color: "text-primary" },
                  { label: "Requesters", val: stats?.totalTakers ?? "—", color: "text-orange-600" },
                  { label: "Open Requests", val: stats?.openRequests ?? "—", color: "text-red-600" },
                  { label: "Fulfilled", val: stats?.fulfilledRequests ?? "—", color: "text-green-600" },
                  { label: "Total Requests", val: stats?.totalRequests ?? "—", color: "text-foreground" },
                  { label: "Total Responses", val: stats?.totalResponses ?? "—", color: "text-blue-600" },
                  { label: "Match Rate", val: stats ? `${stats.totalRequests ? Math.round((stats.fulfilledRequests / stats.totalRequests) * 100) : 0}%` : "—", color: "text-green-600" },
                ].map(s => (
                  <div key={s.label} className="bg-card border border-border rounded-lg p-4">
                    <div className={`font-display text-3xl font-extrabold ${s.color}`}>{s.val}</div>
                    <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
                  </div>
                ))}
              </div>

              <div className="bg-card border border-border rounded-lg p-5">
                <h3 className="font-semibold text-foreground mb-1">Admin Credentials</h3>
                <p className="text-sm text-muted-foreground">Username: <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">admin</code> · Password: <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">lifelink@admin</code></p>
                <p className="text-xs text-muted-foreground mt-2">Change these in <code className="bg-secondary px-1 rounded">supabase/functions/server/index.tsx</code> (ADMIN_USER / ADMIN_PASS constants).</p>
              </div>
            </div>
          )}

          {/* Users */}
          {tab === "users" && (
            <div>
              <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
                <h2 className="font-display text-2xl font-bold text-foreground">Users <span className="text-muted-foreground text-lg font-normal">({filteredUsers.length})</span></h2>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <input placeholder="Search users…" value={search} onChange={e => setSearch(e.target.value)}
                      className="pl-3 pr-8 py-2 bg-input-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary transition-all w-52" />
                    {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="w-3.5 h-3.5" /></button>}
                  </div>
                  <button onClick={loadUsers} className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors">
                    <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground"><Spinner /><span className="text-sm">Loading users…</span></div>
              ) : filteredUsers.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground text-sm">No users found.</div>
              ) : (
                <div className="space-y-2">
                  {filteredUsers.map(u => (
                    <div key={u.id} className="bg-card border border-border rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-9 h-9 rounded-md flex items-center justify-center font-bold text-sm shrink-0 ${u.role === "donor" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}>
                            {u.firstName?.[0]}{u.lastName?.[0]}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground text-sm truncate">{u.firstName} {u.lastName}</p>
                            <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-display font-bold text-primary text-sm">{u.bloodGroup}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${u.role === "donor" ? "bg-primary/10 text-primary border-primary/20" : "bg-orange-50 text-orange-700 border-orange-200"}`}>
                            {u.role}
                          </span>
                          <span className="text-xs text-muted-foreground hidden sm:block">{u.city}</span>
                          <button onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
                            className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                            {expandedUser === u.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                          {confirmDelete === u.id ? (
                            <div className="flex gap-1">
                              <button onClick={() => deleteUser(u.id)} className="text-xs bg-red-600 text-white px-2 py-1 rounded font-semibold">Confirm</button>
                              <button onClick={() => setConfirmDelete(null)} className="text-xs bg-secondary text-foreground px-2 py-1 rounded font-semibold">Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmDelete(u.id)} className="p-1 text-muted-foreground hover:text-red-600 transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {expandedUser === u.id && (
                        <div className="border-t border-border px-4 py-3 bg-secondary/40 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                          {[
                            ["Phone", u.phone], ["Gender", u.gender], ["DOB", u.dob ? formatDate(u.dob) : "—"],
                            ["City", u.city], ["State", u.state], ["Joined", formatDate(u.createdAt)],
                            ...(u.role === "donor" ? [
                              ["Last Donation", u.lastDonationDate ? formatDate(u.lastDonationDate) : "First-time"],
                              ["Available", u.availableTodonate ? "Yes" : "No"],
                              ["Conditions", u.medicalConditions || "None"],
                            ] : [
                              ["Hospital", u.hospital || "—"],
                              ["Units", String(u.unitsRequired ?? 1)],
                              ["Urgency", u.urgency ?? "—"],
                            ]),
                          ].map(([k, v]) => (
                            <div key={k}>
                              <span className="text-muted-foreground text-xs">{k}</span>
                              <p className="font-medium text-foreground truncate">{v}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Requests */}
          {tab === "requests" && (
            <div>
              <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
                <h2 className="font-display text-2xl font-bold text-foreground">Blood Requests <span className="text-muted-foreground text-lg font-normal">({filteredRequests.length})</span></h2>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <input placeholder="Search requests…" value={search} onChange={e => setSearch(e.target.value)}
                      className="pl-3 pr-8 py-2 bg-input-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary transition-all w-52" />
                    {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="w-3.5 h-3.5" /></button>}
                  </div>
                  <button onClick={loadRequests} className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors">
                    <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground"><Spinner /><span className="text-sm">Loading requests…</span></div>
              ) : filteredRequests.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground text-sm">No requests found.</div>
              ) : (
                <div className="space-y-2">
                  {filteredRequests.map(req => {
                    const uc = URGENCY_COLORS[req.urgency];
                    return (
                      <div key={req.id} className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap">
                        <div className={`w-10 h-10 rounded-md flex items-center justify-center font-display font-extrabold text-sm text-primary border shrink-0 ${uc.card}`}>
                          {req.bloodGroup}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-foreground text-sm">{req.patientName || req.takerName}</p>
                          <p className="text-xs text-muted-foreground truncate">{req.hospital} · {req.city} · {req.unitsRequired} unit{req.unitsRequired > 1 ? "s" : ""}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${uc.badge}`}>{req.urgency}</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${req.status === "open" ? "bg-blue-50 text-blue-700 border-blue-200" : req.status === "fulfilled" ? "bg-green-50 text-green-700 border-green-200" : "bg-secondary text-muted-foreground border-border"}`}>
                            {req.status}
                          </span>
                          <span className="text-xs text-muted-foreground">{req.responseCount} resp.</span>
                          <span className="text-xs text-muted-foreground hidden sm:block">{timeAgo(req.createdAt)}</span>

                          {req.status === "open" && (
                            <button onClick={() => updateRequestStatus(req.id, "fulfilled")}
                              title="Mark fulfilled"
                              className="p-1 text-muted-foreground hover:text-green-600 transition-colors">
                              <CircleCheck className="w-4 h-4" />
                            </button>
                          )}
                          {req.status !== "closed" && (
                            <button onClick={() => updateRequestStatus(req.id, "closed")}
                              title="Close request"
                              className="p-1 text-muted-foreground hover:text-orange-500 transition-colors">
                              <Ban className="w-4 h-4" />
                            </button>
                          )}
                          {confirmDelete === req.id ? (
                            <div className="flex gap-1">
                              <button onClick={() => deleteRequest(req.id)} className="text-xs bg-red-600 text-white px-2 py-1 rounded font-semibold">Confirm</button>
                              <button onClick={() => setConfirmDelete(null)} className="text-xs bg-secondary text-foreground px-2 py-1 rounded font-semibold">Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmDelete(req.id)} className="p-1 text-muted-foreground hover:text-red-600 transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Responses */}
          {tab === "responses" && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-2xl font-bold text-foreground">Donor Responses <span className="text-muted-foreground text-lg font-normal">({responses.length})</span></h2>
                <button onClick={loadResponses} className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors">
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground"><Spinner /><span className="text-sm">Loading responses…</span></div>
              ) : responses.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground text-sm">No responses yet.</div>
              ) : (
                <div className="space-y-2">
                  {responses.map(r => (
                    <div key={r.id} className="bg-card border border-border rounded-lg px-4 py-3 flex items-start gap-4 flex-wrap">
                      <div className="w-10 h-10 rounded-md bg-accent border border-primary/20 flex items-center justify-center font-display font-extrabold text-sm text-primary shrink-0">
                        {r.donorBloodGroup}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <p className="font-semibold text-foreground text-sm">{r.donorName}</p>
                          <span className="text-xs text-muted-foreground">→</span>
                          <p className="text-sm text-muted-foreground truncate">Request {r.requestId.slice(0, 8)}…</p>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{r.donorPhone}</span>
                          <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{r.donorEmail}</span>
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{r.donorCity}</span>
                          <span>{timeAgo(r.createdAt)}</span>
                        </div>
                        {r.message && <p className="text-xs text-foreground/60 italic mt-1">"{r.message}"</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Admin Credentials Modal */}
      {showCredentials && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-display font-bold text-foreground flex items-center gap-2">
                <Lock className="w-4 h-4 text-primary" /> Admin Credentials
              </h3>
              <button onClick={() => setShowCredentials(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            {credDone ? (
              <div className="text-center py-6">
                <CheckCircle className="w-10 h-10 text-green-600 mx-auto mb-3" />
                <p className="font-semibold text-foreground">Credentials updated!</p>
                <p className="text-xs text-muted-foreground mt-1 mb-4">Use the new credentials next time you log in.</p>
                <button onClick={() => setShowCredentials(false)}
                  className="w-full bg-primary text-primary-foreground py-2.5 rounded-md font-semibold text-sm hover:bg-primary/90 transition-colors">Done</button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Current Password</label>
                  <div className="relative mt-1">
                    <input type="password" value={credForm.currentPassword}
                      onChange={e => setCredForm(f => ({ ...f, currentPassword: e.target.value }))}
                      className="w-full px-3 py-2 rounded-md bg-input-background border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New Username <span className="text-muted-foreground font-normal normal-case">(leave blank to keep)</span></label>
                  <input value={credForm.newUsername}
                    onChange={e => setCredForm(f => ({ ...f, newUsername: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 rounded-md bg-input-background border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New Password <span className="text-muted-foreground font-normal normal-case">(leave blank to keep)</span></label>
                  <input type="password" value={credForm.newPassword}
                    onChange={e => setCredForm(f => ({ ...f, newPassword: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 rounded-md bg-input-background border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                {credForm.newPassword && (
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Confirm New Password</label>
                    <input type="password" value={credForm.confirmPassword}
                      onChange={e => setCredForm(f => ({ ...f, confirmPassword: e.target.value }))}
                      className="w-full mt-1 px-3 py-2 rounded-md bg-input-background border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                )}
                {credError && <p className="text-xs text-destructive">{credError}</p>}
                <button disabled={credLoading} onClick={async () => {
                  if (!credForm.currentPassword) { setCredError("Current password is required."); return; }
                  if (credForm.newPassword && credForm.newPassword !== credForm.confirmPassword) { setCredError("Passwords do not match."); return; }
                  if (credForm.newPassword && credForm.newPassword.length < 6) { setCredError("New password must be at least 6 characters."); return; }
                  setCredLoading(true); setCredError("");
                  try {
                    const data = await api("/admin/credentials", {
                      method: "PUT",
                      body: JSON.stringify({ currentPassword: credForm.currentPassword, newUsername: credForm.newUsername || undefined, newPassword: credForm.newPassword || undefined }),
                    });
                    if (data.error) { setCredError(data.error); return; }
                    setCredDone(true);
                  } catch { setCredError("Something went wrong."); }
                  finally { setCredLoading(false); }
                }}
                  className="w-full bg-primary text-primary-foreground py-2.5 rounded-md font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                  {credLoading ? <><Spinner /> Saving…</> : "Update Credentials"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── API Status Banner ─────────────────────────────────────────────────────
function ApiStatusBanner() {
  const [status, setStatus] = useState<"checking" | "ok" | "error">("checking");

  useEffect(() => {
    api("/health")
      .then(() => setStatus("ok"))
      .catch(() => setStatus("error"));
  }, []);

  if (status === "ok" || status === "checking") return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white text-sm px-4 py-3 flex items-center justify-center gap-2 shadow-lg">
      <AlertCircle className="w-4 h-4 shrink-0" />
      <span>
        <strong>Backend not reachable.</strong> Go to{" "}
        <strong>Make Settings → Supabase → Deploy Edge Function</strong>, then refresh this page.
      </span>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState<AppScreen>("landing");
  const [profile, setProfile] = useState<Profile | null>(null);

  const goToDashboard = (p: Profile) => {
    setProfile(p);
    setScreen("dashboard");
  };

  return (
    <div>
      <style>{`
        .font-display { font-family: 'Plus Jakarta Sans', sans-serif; }
        * { scrollbar-width: none; }
        *::-webkit-scrollbar { display: none; }
      `}</style>

      <ApiStatusBanner />

      {screen === "landing" && (
        <LandingScreen
          onLogin={() => setScreen("login")}
          onRegister={() => setScreen("register")}
          onAdmin={() => setScreen("admin-login")} />
      )}
      {screen === "login" && (
        <LoginScreen
          onBack={() => setScreen("landing")}
          onGoRegister={() => setScreen("register")}
          onSuccess={goToDashboard} />
      )}
      {screen === "register" && (
        <RegisterScreen
          onBack={() => setScreen("landing")}
          onGoLogin={() => setScreen("login")}
          onComplete={goToDashboard} />
      )}
      {screen === "dashboard" && profile && (
        <DashboardScreen
          profile={profile}
          onLogout={() => { setProfile(null); setScreen("landing"); }} />
      )}
      {screen === "admin-login" && (
        <AdminLoginScreen
          onBack={() => setScreen("landing")}
          onSuccess={() => setScreen("admin")} />
      )}
      {screen === "admin" && (
        <AdminPanel onLogout={() => setScreen("landing")} />
      )}
    </div>
  );
}
