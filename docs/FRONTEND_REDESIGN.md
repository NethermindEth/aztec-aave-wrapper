Current Page Analysis
Aztec Aave is a privacy-preserving lending DeFi protocol that bridges USDC from Ethereum L1 to Aztec L2 for private Aave deposits.
Current Design Issues:

Dark, flat aesthetic - Lacks visual hierarchy and depth
Minimal branding - No visual identity beyond the logo
Dense information - No visual breathing room
Basic tab design - Functional but uninspiring
No visual feedback - Status indicators are text-only
Monochromatic - Limited color palette makes it feel dated


Modern DeFi Redesign Proposal
Design Philosophy

Glassmorphism + Gradient accents for a premium feel
Privacy-focused visual language (shields, locks, gradient masks)
Animated status indicators for network connections
Card-based modular layout with subtle shadows
Purple/Cyan gradient theme (common in privacy-focused DeFi)


Wireframe (ASCII/Markdown)
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ◆ AZTEC AAVE                          [●L1] [●L2]    [Connect ETH] [Connect Aztec] │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│    ╔═══════════════════════════════════════════════════════════════════════╗    │
│    ║                    🛡️ PRIVACY-PRESERVING LENDING                      ║    │
│    ║        Deposit into Aave V3 from Aztec L2 • Keep your identity private ║    │
│    ╚═══════════════════════════════════════════════════════════════════════╝    │
│                                                                                 │
│    ┌─────────────────────────────────────────────────────────────────────┐     │
│    │  DEPLOYED CONTRACTS                                                  │     │
│    │  ┌──────────┐ ┌──────────┐ ┌──────────┐                             │     │
│    │  │ Portal   │ │ L1Token  │ │ L2Bridge │  ← clickable pills          │     │
│    │  │ 0x1a2... │ │ 0x3b4... │ │ 0x5c6... │                             │     │
│    │  └──────────┘ └──────────┘ └──────────┘                             │     │
│    └─────────────────────────────────────────────────────────────────────┘     │
│                                                                                 │
│    ┌───────────────────────────────────────────────────────────────────────┐   │
│    │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                      │   │
│    │  │   BRIDGE    │ │   DEPOSIT   │ │  WITHDRAW   │   ← Tab Navigation   │   │
│    │  └─────────────┘ └─────────────┘ └─────────────┘                      │   │
│    │ ┌───────────────────────────────────────────────────────────────────┐ │   │
│    │ │                                                                   │ │   │
│    │ │  💫 Bridge USDC to L2                                             │ │   │
│    │ │  ─────────────────────────────────────────────────────────────    │ │   │
│    │ │                                                                   │ │   │
│    │ │  ┌─────────────────────────────────────────────────────────────┐  │ │   │
│    │ │  │  USDC                                              [MAX]   │  │ │   │
│    │ │  │  ┌─────────────────────────────────────────────────────┐   │  │ │   │
│    │ │  │  │                        0.00                         │   │  │ │   │
│    │ │  │  └─────────────────────────────────────────────────────┘   │  │ │   │
│    │ │  │                                     Balance: 0.00 USDC     │  │ │   │
│    │ │  └─────────────────────────────────────────────────────────────┘  │ │   │
│    │ │                                                                   │ │   │
│    │ │  ┌─────────────────────────────────────────────────────────────┐  │ │   │
│    │ │  │              🔗 Connect ETH Wallet                          │  │ │   │
│    │ │  └─────────────────────────────────────────────────────────────┘  │ │   │
│    │ │                                                                   │ │   │
│    │ └───────────────────────────────────────────────────────────────────┘ │   │
│    └───────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│    ┌───────────────────────────────────────────────────────────────────────┐   │
│    │  📊 YOUR POSITIONS                                    [↻ Refresh]     │   │
│    │ ┌───────────────────────────────────────────────────────────────────┐ │   │
│    │ │                                                                   │ │   │
│    │ │     ○                                                             │ │   │
│    │ │    ╱ ╲       No positions yet                                     │ │   │
│    │ │   ○───○      Deposit USDC to create your first position           │ │   │
│    │ │                                                                   │ │   │
│    │ └───────────────────────────────────────────────────────────────────┘ │   │
│    └───────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│    ┌───────────────────────────────────────────────────────────────────────┐   │
│    │  ⚠️ RECOVER STUCK DEPOSIT                                      [▼]   │   │
│    └───────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│    ┌───────────────────────────────────────────────────────────────────────┐   │
│    │  📝 OPERATION LOGS                                                    │   │
│    │ ┌───────────────────────────────────────────────────────────────────┐ │   │
│    │ │  No logs yet                                                      │ │   │
│    │ └───────────────────────────────────────────────────────────────────┘ │   │
│    └───────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

Complete Modern CSS
/* ═══════════════════════════════════════════════════════════════════════════
   AZTEC AAVE - Modern DeFi Protocol Redesign
   Theme: Glassmorphism + Privacy-focused gradients
   ═══════════════════════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────────────────────────────────
   CSS VARIABLES (Design Tokens)
   ────────────────────────────────────────────────────────────────────────── */
:root {
  /* Primary Colors */
  --primary-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
  --accent-gradient: linear-gradient(135deg, #00d4aa 0%, #00b4d8 100%);
  --cta-gradient: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
  
  /* Background Colors */
  --bg-dark: #0a0a0f;
  --bg-card: rgba(255, 255, 255, 0.03);
  --bg-card-hover: rgba(255, 255, 255, 0.06);
  --bg-input: rgba(0, 0, 0, 0.4);
  --bg-glass: rgba(255, 255, 255, 0.05);
  
  /* Text Colors */
  --text-primary: #ffffff;
  --text-secondary: rgba(255, 255, 255, 0.7);
  --text-muted: rgba(255, 255, 255, 0.4);
  --text-accent: #00d4aa;
  
  /* Border Colors */
  --border-glass: rgba(255, 255, 255, 0.1);
  --border-active: rgba(102, 126, 234, 0.5);
  --border-glow: rgba(102, 126, 234, 0.3);
  
  /* Status Colors */
  --status-success: #00d4aa;
  --status-warning: #f59e0b;
  --status-error: #ef4444;
  --status-pending: #8b5cf6;
  
  /* Shadows */
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 20px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 40px rgba(0, 0, 0, 0.5);
  --shadow-glow: 0 0 40px rgba(102, 126, 234, 0.15);
  --shadow-cta: 0 4px 30px rgba(102, 126, 234, 0.4);
  
  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;
  
  /* Border Radius */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-full: 9999px;
  
  /* Typography */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  /* Fonts should be loaded in the app (self-host or import). */
  
  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-base: 250ms ease;
  --transition-slow: 400ms ease;
}

/* ──────────────────────────────────────────────────────────────────────────
   RESET & BASE STYLES
   ────────────────────────────────────────────────────────────────────────── */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-size: 16px;
  scroll-behavior: smooth;
}

body {
  font-family: var(--font-sans);
  background: var(--bg-dark);
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Background gradient mesh */
body::before {
  content: '';
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: 
    radial-gradient(ellipse 80% 50% at 20% -20%, rgba(102, 126, 234, 0.15) 0%, transparent 50%),
    radial-gradient(ellipse 60% 40% at 80% 100%, rgba(118, 75, 162, 0.1) 0%, transparent 50%),
    radial-gradient(ellipse 40% 30% at 50% 50%, rgba(0, 212, 170, 0.05) 0%, transparent 50%);
  pointer-events: none;
  z-index: -1;
}

/* ──────────────────────────────────────────────────────────────────────────
   HEADER / NAVIGATION
   ────────────────────────────────────────────────────────────────────────── */
.header {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-md) var(--space-xl);
  background: rgba(10, 10, 15, 0.8);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border-glass);
}

.logo {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: 1.25rem;
  font-weight: 700;
  background: var(--primary-gradient);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.logo-icon {
  width: 36px;
  height: 36px;
  background: var(--primary-gradient);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.125rem;
  color: white;
  -webkit-text-fill-color: white;
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
}

/* Network Status Indicators */
.network-status {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.network-indicator {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  background: var(--bg-glass);
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.network-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--status-error);
  position: relative;
}

.network-dot.connected {
  background: var(--status-success);
  box-shadow: 0 0 10px var(--status-success);
}

.network-dot.connecting {
  background: var(--status-warning);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.2); }
}

/* Wallet Buttons */
.wallet-buttons {
  display: flex;
  gap: var(--space-sm);
}

.btn-wallet {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-glass);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-base);
}

.btn-wallet:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-active);
  transform: translateY(-1px);
}

.btn-wallet.connected {
  background: linear-gradient(135deg, rgba(0, 212, 170, 0.1) 0%, rgba(0, 180, 216, 0.1) 100%);
  border-color: rgba(0, 212, 170, 0.3);
}

/* ──────────────────────────────────────────────────────────────────────────
   MAIN CONTAINER
   ────────────────────────────────────────────────────────────────────────── */
.main-container {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--space-xl) var(--space-md);
}

/* ──────────────────────────────────────────────────────────────────────────
   HERO SECTION
   ────────────────────────────────────────────────────────────────────────── */
.hero {
  text-align: center;
  padding: var(--space-2xl) 0;
  position: relative;
}

.hero::before {
  content: '🛡️';
  font-size: 3rem;
  display: block;
  margin-bottom: var(--space-md);
  filter: drop-shadow(0 0 20px rgba(102, 126, 234, 0.5));
}

.hero-title {
  font-size: clamp(1.75rem, 5vw, 2.5rem);
  font-weight: 800;
  background: var(--primary-gradient);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: var(--space-sm);
  letter-spacing: -0.02em;
}

.hero-subtitle {
  font-size: 1rem;
  color: var(--text-secondary);
  max-width: 500px;
  margin: 0 auto;
}

/* ──────────────────────────────────────────────────────────────────────────
   GLASS CARD COMPONENT
   ────────────────────────────────────────────────────────────────────────── */
.glass-card {
  background: var(--bg-card);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  margin-bottom: var(--space-lg);
  transition: all var(--transition-base);
  position: relative;
  overflow: hidden;
}

.glass-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
}

.glass-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-active);
  box-shadow: var(--shadow-glow);
  transform: translateY(-2px);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-md);
}

.card-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* ──────────────────────────────────────────────────────────────────────────
   CONTRACT PILLS
   ────────────────────────────────────────────────────────────────────────── */
.contracts-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.contract-pill {
  display: flex;
  flex-direction: column;
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-glass);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.contract-pill:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-active);
}

.contract-name {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-bottom: 2px;
}

.contract-address {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--text-accent);
}

/* ──────────────────────────────────────────────────────────────────────────
   TAB NAVIGATION
   ────────────────────────────────────────────────────────────────────────── */
.tab-navigation {
  display: flex;
  background: var(--bg-glass);
  border-radius: var(--radius-md);
  padding: var(--space-xs);
  margin-bottom: var(--space-lg);
  border: 1px solid var(--border-glass);
}

.tab-button {
  flex: 1;
  padding: var(--space-sm) var(--space-md);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;
}

.tab-button:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.05);
}

.tab-button.active {
  background: var(--cta-gradient);
  color: white;
  box-shadow: var(--shadow-sm);
}

/* ──────────────────────────────────────────────────────────────────────────
   TAB PANEL CONTENT
   ────────────────────────────────────────────────────────────────────────── */
.tab-panel {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.panel-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
}

.panel-icon {
  font-size: 1.5rem;
}

.panel-title {
  font-size: 1.25rem;
  font-weight: 600;
}

.panel-divider {
  height: 1px;
  background: linear-gradient(90deg, var(--border-glass), transparent);
  margin-bottom: var(--space-lg);
}

/* Info Alert */
.info-alert {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  padding: var(--space-md);
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
  border: 1px solid rgba(102, 126, 234, 0.2);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-lg);
}

.info-alert-icon {
  font-size: 1rem;
  line-height: 1.5;
}

.info-alert-text {
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

/* ──────────────────────────────────────────────────────────────────────────
   INPUT FIELDS
   ────────────────────────────────────────────────────────────────────────── */
.input-group {
  margin-bottom: var(--space-lg);
}

.input-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-sm);
}

.label-text {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.label-balance {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--bg-input);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.input-wrapper:focus-within {
  border-color: var(--border-active);
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.input-token {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-md);
  background: rgba(255, 255, 255, 0.05);
  border-right: 1px solid var(--border-glass);
  font-size: 0.875rem;
  font-weight: 600;
}

.token-icon {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, #2775ca 0%, #3b82f6 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.625rem;
  font-weight: 700;
}

.input-field {
  flex: 1;
  padding: var(--space-md);
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 1.25rem;
  font-weight: 600;
  text-align: right;
  outline: none;
}

.input-field::placeholder {
  color: var(--text-muted);
}

.btn-max {
  padding: var(--space-xs) var(--space-sm);
  margin-right: var(--space-md);
  background: var(--accent-gradient);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--bg-dark);
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-max:hover {
  transform: scale(1.05);
  box-shadow: 0 0 15px rgba(0, 212, 170, 0.4);
}

/* Select Dropdown */
.select-wrapper {
  position: relative;
}

.select-field {
  width: 100%;
  padding: var(--space-md);
  background: var(--bg-input);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.875rem;
  cursor: pointer;
  appearance: none;
  outline: none;
  transition: all var(--transition-fast);
}

.select-field:focus {
  border-color: var(--border-active);
}

.select-arrow {
  position: absolute;
  right: var(--space-md);
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  color: var(--text-muted);
}

.input-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: var(--space-xs);
}

/* ──────────────────────────────────────────────────────────────────────────
   CTA BUTTON
   ────────────────────────────────────────────────────────────────────────── */
.btn-cta {
  width: 100%;
  padding: var(--space-md) var(--space-lg);
  background: var(--cta-gradient);
  border: none;
  border-radius: var(--radius-md);
  color: white;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-base);
  position: relative;
  overflow: hidden;
}

.btn-cta::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
  transition: left 0.5s ease;
}

.btn-cta:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-cta);
}

.btn-cta:hover::before {
  left: 100%;
}

.btn-cta:active {
  transform: translateY(0);
}

.btn-cta:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.btn-cta:disabled:hover::before {
  left: -100%;
}

/* ──────────────────────────────────────────────────────────────────────────
   POSITIONS SECTION
   ────────────────────────────────────────────────────────────────────────── */
.positions-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-md);
}

.positions-title {
  font-size: 1rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.btn-refresh {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  background: var(--bg-glass);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-refresh:hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}

.btn-refresh:active .refresh-icon {
  animation: spin 0.5s ease;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: var(--space-2xl) var(--space-lg);
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: var(--space-md);
  opacity: 0.3;
}

.empty-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: var(--space-xs);
}

.empty-description {
  font-size: 0.875rem;
  color: var(--text-muted);
}

/* Position Card (when positions exist) */
.position-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-md);
  background: var(--bg-glass);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-sm);
  transition: all var(--transition-fast);
}

.position-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-active);
}

.position-info {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.position-token-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, #2775ca 0%, #3b82f6 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.75rem;
}

.position-details {
  display: flex;
  flex-direction: column;
}

.position-amount {
  font-size: 1rem;
  font-weight: 600;
}

.position-value {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.position-apy {
  text-align: right;
}

.apy-label {
  font-size: 0.625rem;
  color: var(--text-muted);
  text-transform: uppercase;
}

.apy-value {
  font-size: 1rem;
  font-weight: 600;
  color: var(--status-success);
}

/* ──────────────────────────────────────────────────────────────────────────
   ACCORDION / COLLAPSIBLE
   ────────────────────────────────────────────────────────────────────────── */
.accordion {
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  overflow: hidden;
  margin-bottom: var(--space-lg);
}

.accordion-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-md);
  background: var(--bg-glass);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.accordion-header:hover {
  background: var(--bg-card-hover);
}

.accordion-title {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: 0.875rem;
  font-weight: 600;
}

.accordion-icon {
  color: var(--status-warning);
}

.accordion-description {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 2px;
}

.accordion-chevron {
  transition: transform var(--transition-fast);
  color: var(--text-muted);
}

.accordion.open .accordion-chevron {
  transform: rotate(180deg);
}

.accordion-content {
  padding: var(--space-md);
  background: var(--bg-input);
  display: none;
}

.accordion.open .accordion-content {
  display: block;
  animation: slideDown 0.3s ease;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ──────────────────────────────────────────────────────────────────────────
   OPERATION LOGS
   ────────────────────────────────────────────────────────────────────────── */
.logs-container {
  background: var(--bg-input);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  max-height: 200px;
  overflow-y: auto;
}

.logs-empty {
  text-align: center;
  padding: var(--space-lg);
  color: var(--text-muted);
  font-size: 0.875rem;
}

.log-entry {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  padding: var(--space-sm) 0;
  border-bottom: 1px solid var(--border-glass);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.log-entry:last-child {
  border-bottom: none;
}

.log-time {
  color: var(--text-muted);
  white-space: nowrap;
}

.log-type {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
}

.log-type.info { background: rgba(102, 126, 234, 0.2); color: #667eea; }
.log-type.success { background: rgba(0, 212, 170, 0.2); color: var(--status-success); }
.log-type.warning { background: rgba(245, 158, 11, 0.2); color: var(--status-warning); }
.log-type.error { background: rgba(239, 68, 68, 0.2); color: var(--status-error); }

.log-message {
  color: var(--text-secondary);
  word-break: break-word;
}

/* Custom scrollbar */
.logs-container::-webkit-scrollbar {
  width: 6px;
}

.logs-container::-webkit-scrollbar-track {
  background: transparent;
}

.logs-container::-webkit-scrollbar-thumb {
  background: var(--border-glass);
  border-radius: 3px;
}

.logs-container::-webkit-scrollbar-thumb:hover {
  background: var(--border-active);
}

/* ──────────────────────────────────────────────────────────────────────────
   RESPONSIVE DESIGN
   ────────────────────────────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .header {
    flex-wrap: wrap;
    gap: var(--space-md);
    padding: var(--space-md);
  }
  
  .header-right {
    width: 100%;
    justify-content: space-between;
  }
  
  .network-status {
    width: 100%;
    justify-content: flex-start;
  }
  
  .wallet-buttons {
    width: 100%;
    justify-content: flex-end;
  }
  
  .main-container {
    padding: var(--space-lg) var(--space-md);
  }
  
  .hero {
    padding: var(--space-xl) 0;
  }
  
  .tab-navigation {
    flex-direction: column;
  }
  
  .tab-button {
    width: 100%;
  }
}
