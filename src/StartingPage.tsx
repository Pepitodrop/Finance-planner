import { useEffect } from 'react'
import {
  BadgeEuro,
  Banknote,
  BrainCircuit,
  ChartNoAxesCombined,
  Check,
  CreditCard,
  Landmark,
  LockKeyhole,
  PiggyBank,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from 'lucide-react'
import './starting-page.css'

const featureCards = [
  {
    icon: Landmark,
    title: 'Connect banks securely',
    copy: 'Bring supported bank accounts into one private overview and keep balances close at hand.',
  },
  {
    icon: RefreshCw,
    title: 'Track transactions automatically',
    copy: 'Review imported activity, categories and recurring patterns without rebuilding your finances by hand.',
  },
  {
    icon: PiggyBank,
    title: 'Budgets & savings goals',
    copy: 'Turn day-to-day spending into goals, targets and a clearer view of what comes next.',
  },
  {
    icon: BrainCircuit,
    title: 'Smart analytics & AI insights',
    copy: 'Spot patterns, unusual activity and useful next steps with finance intelligence built into the workflow.',
  },
]

const securityItems = [
  'Encrypted finance data',
  'Read-only connection flows where supported',
  'No advertising profile built from your finances',
  'Account-level data controls and reset tools',
]

const faqItems = [
  ['Is my bank data safe?', 'Finance Planner is designed around encrypted financial state, explicit connection flows and user-controlled data tools.'],
  ['Which accounts can I bring together?', 'The product is being built around bank connections, PayPal, manual accounts and imported finance activity.'],
  ['Does the starting page change my dashboard?', 'No. This preview is isolated under /startingPage and does not replace or redirect the existing application.'],
  ['Do the buttons on this page navigate anywhere?', 'No. For now the page is a visual starting-page preview only, so every call-to-action is intentionally non-navigating.'],
]

function StartingPage() {
  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Finance Planner — Starting Page Preview'

    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
    const createdRobots = !robots
    const previousRobots = robots?.getAttribute('content') ?? null
    if (!robots) {
      robots = document.createElement('meta')
      robots.name = 'robots'
      document.head.appendChild(robots)
    }
    robots.content = 'noindex,nofollow'

    return () => {
      document.title = previousTitle
      if (createdRobots) robots?.remove()
      else if (robots && previousRobots !== null) robots.content = previousRobots
    }
  }, [])

  return (
    <main className="starting-page">
      <div className="starting-page__ambient starting-page__ambient--one" aria-hidden="true" />
      <div className="starting-page__ambient starting-page__ambient--two" aria-hidden="true" />

      <div className="starting-page__shell">
        <header className="starting-nav">
          <div className="starting-brand" aria-label="Finance Planner">
            <span className="starting-brand__mark"><WalletCards size={18} /></span>
            <span>Finance Planner</span>
          </div>
          <nav className="starting-nav__links" aria-label="Preview sections">
            <span>Features</span>
            <span>Security</span>
            <span>Planning</span>
            <span>FAQ</span>
          </nav>
          <div className="starting-nav__actions">
            <span className="starting-nav__login">Log in</span>
            <span className="starting-cta starting-cta--small">Open dashboard</span>
          </div>
        </header>

        <section className="starting-hero" aria-labelledby="starting-hero-title">
          <div className="starting-hero__copy">
            <div className="starting-kicker"><Sparkles size={14} /> Smarter insights. A clearer financial future.</div>
            <h1 id="starting-hero-title">All your finances.<br /><span>One clear picture.</span></h1>
            <p>
              Connect bank accounts and PayPal, track transactions, manage budgets, analyse spending and use finance intelligence — all in one place.
            </p>
            <div className="starting-hero__actions" aria-label="Preview actions">
              <span className="starting-cta">Open dashboard</span>
              <span className="starting-secondary">See how it works</span>
            </div>
            <div className="starting-trust-points">
              <span><Check size={15} /> Bank connections</span>
              <span><Check size={15} /> PayPal sync</span>
              <span><Check size={15} /> Privacy first</span>
            </div>
          </div>

          <div className="starting-product-stage" aria-label="Finance Planner dashboard preview">
            <div className="starting-dashboard">
              <aside className="starting-dashboard__side">
                <div className="starting-dashboard__mini-brand"><WalletCards size={15} /><span>Finance Planner</span></div>
                {['Dashboard', 'Accounts', 'Transactions', 'Budgets', 'Goals', 'Analytics', 'Insights', 'Settings'].map((item, index) => (
                  <span key={item} className={index === 0 ? 'is-active' : ''}>{item}</span>
                ))}
              </aside>

              <div className="starting-dashboard__content">
                <div className="starting-dashboard__toolbar">
                  <span className="starting-dashboard__search">Search transactions, categories…</span>
                  <span className="starting-avatar">LB</span>
                </div>
                <div className="starting-dashboard__heading">
                  <div><strong>Good evening, Luis 👋</strong><small>Your financial overview</small></div>
                  <span>September 2026</span>
                </div>

                <div className="starting-stat-grid">
                  <article><small>Total balance</small><strong>12.420 €</strong><span className="positive">+2.3%</span></article>
                  <article><small>Monthly income</small><strong>3.820 €</strong><span className="positive">+12%</span></article>
                  <article><small>Monthly spending</small><strong>2.480 €</strong><span className="negative">+5%</span></article>
                  <article><small>Savings rate</small><strong>28%</strong><span className="positive">On track</span></article>
                </div>

                <div className="starting-dashboard__middle">
                  <article className="starting-chart-card">
                    <div className="starting-card-title"><span>Cash flow</span><small>Income · Expenses</small></div>
                    <svg viewBox="0 0 420 155" role="img" aria-label="Illustrative cash flow chart">
                      <defs>
                        <linearGradient id="incomeGlow" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#6d7cff" stopOpacity=".45" />
                          <stop offset="100%" stopColor="#6d7cff" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path className="chart-grid" d="M20 25H400M20 65H400M20 105H400M20 145H400" />
                      <path className="chart-area" d="M20 119 C70 97, 95 102, 130 79 S190 72, 225 59 S285 50, 315 36 S365 39, 400 23 L400 145 L20 145 Z" />
                      <path className="chart-line chart-line--income" d="M20 119 C70 97, 95 102, 130 79 S190 72, 225 59 S285 50, 315 36 S365 39, 400 23" />
                      <path className="chart-line chart-line--expense" d="M20 132 C70 124, 105 129, 145 112 S205 118, 245 96 S305 105, 340 87 S375 93, 400 78" />
                    </svg>
                  </article>

                  <article className="starting-category-card">
                    <div className="starting-card-title"><span>Spending by category</span><small>This month</small></div>
                    <div className="starting-donut-row">
                      <div className="starting-donut"><span><strong>2.480 €</strong><small>spent</small></span></div>
                      <ul>
                        <li><i className="dot dot--1" /> Housing <b>32%</b></li>
                        <li><i className="dot dot--2" /> Food <b>18%</b></li>
                        <li><i className="dot dot--3" /> Transport <b>12%</b></li>
                        <li><i className="dot dot--4" /> Other <b>38%</b></li>
                      </ul>
                    </div>
                  </article>
                </div>

                <div className="starting-dashboard__bottom">
                  <article>
                    <div className="starting-card-title"><span>Accounts</span><small>3 connected</small></div>
                    <div className="starting-account-row"><Landmark size={15} /><span>Checking</span><strong>7.230 €</strong></div>
                    <div className="starting-account-row"><Banknote size={15} /><span>Savings</span><strong>3.410 €</strong></div>
                    <div className="starting-account-row"><CreditCard size={15} /><span>PayPal</span><strong>1.780 €</strong></div>
                  </article>
                  <article>
                    <div className="starting-card-title"><span>Recent transactions</span><small>Live overview</small></div>
                    <div className="starting-transaction"><span>REWE</span><strong>-64,32 €</strong></div>
                    <div className="starting-transaction"><span>Spotify</span><strong>-10,99 €</strong></div>
                    <div className="starting-transaction"><span>Salary</span><strong className="positive">+2.450 €</strong></div>
                  </article>
                  <article className="starting-insight">
                    <div className="starting-card-title"><span><Sparkles size={14} /> AI insight</span><small>New</small></div>
                    <strong>Dining spend is up 12%</strong>
                    <p>You could save around 180 € this month by shifting a few recurring choices.</p>
                  </article>
                </div>
              </div>
            </div>

            <div className="starting-phone" aria-hidden="true">
              <div className="starting-phone__speaker" />
              <div className="starting-phone__screen">
                <div className="starting-phone__top"><span>9:41</span><span>● ● ▰</span></div>
                <div className="starting-phone__brand"><WalletCards size={16} /><strong>Finance Planner</strong><span>☰</span></div>
                <div className="starting-phone__hero">
                  <small>YOUR MONEY, CLEARLY</small>
                  <strong>All your finances.<br /><em>One clear picture.</em></strong>
                  <p>Accounts, transactions, planning and insights together.</p>
                  <span className="starting-phone__cta">Open dashboard</span>
                </div>
                <div className="starting-phone__balance"><small>Total balance</small><strong>12.420 €</strong><span>+2.3%</span></div>
                <div className="starting-phone__mini-chart"><i /><i /><i /><i /><i /><i /><i /></div>
                <div className="starting-phone__nav"><span>⌂<small>Home</small></span><span>▣<small>Accounts</small></span><span>✦<small>Insights</small></span><span>•••<small>More</small></span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="starting-integrations" aria-label="Finance Planner capabilities">
          <span><Landmark size={19} /> Bank accounts</span>
          <span><CreditCard size={19} /> PayPal</span>
          <span><PiggyBank size={19} /> Budgets</span>
          <span><ChartNoAxesCombined size={19} /> Analytics</span>
          <span><Sparkles size={19} /> AI insights</span>
          <span><BadgeEuro size={19} /> Planning</span>
        </section>

        <section className="starting-section" aria-labelledby="starting-features-title">
          <div className="starting-section__intro">
            <span className="starting-section__label">Features</span>
            <h2 id="starting-features-title">Everything you need for a better financial overview</h2>
            <p>Built to make everyday money management clearer without turning your finances into another full-time job.</p>
          </div>
          <div className="starting-feature-grid">
            {featureCards.map(({ icon: Icon, title, copy }) => (
              <article key={title} className="starting-feature-card">
                <span className="starting-icon"><Icon size={19} /></span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="starting-security-section" aria-labelledby="starting-security-title">
          <div className="starting-security-copy">
            <span className="starting-section__label">Your data. Yours.</span>
            <h2 id="starting-security-title">Security & privacy by design</h2>
            <p>Financial data is sensitive. The product experience should make that obvious at every step — from connections to backups and reset controls.</p>
            <div className="starting-security-list">
              {securityItems.map((item) => <span key={item}><ShieldCheck size={17} /> {item}</span>)}
            </div>
          </div>
          <div className="starting-security-visual">
            <div className="starting-security-orbit starting-security-orbit--outer" />
            <div className="starting-security-orbit starting-security-orbit--inner" />
            <span className="starting-security-lock"><LockKeyhole size={34} /></span>
            <span className="starting-security-chip starting-security-chip--one">Encrypted state</span>
            <span className="starting-security-chip starting-security-chip--two">Private by default</span>
            <span className="starting-security-chip starting-security-chip--three">You stay in control</span>
          </div>
        </section>

        <section className="starting-planning" aria-labelledby="starting-planning-title">
          <div className="starting-section__intro starting-section__intro--left">
            <span className="starting-section__label">Plan ahead</span>
            <h2 id="starting-planning-title">See where your money can take you next</h2>
            <p>Pair your current position with savings goals, recurring commitments and a forward-looking plan.</p>
          </div>
          <div className="starting-plan-cards">
            <article><span className="starting-icon"><PiggyBank size={19} /></span><small>Emergency fund</small><strong>6.500 € / 10.000 €</strong><div><i style={{ width: '65%' }} /></div><em>65% funded</em></article>
            <article><span className="starting-icon"><BadgeEuro size={19} /></span><small>Summer holiday</small><strong>1.100 € / 2.500 €</strong><div><i style={{ width: '44%' }} /></div><em>44% funded</em></article>
            <article><span className="starting-icon"><ChartNoAxesCombined size={19} /></span><small>Monthly savings rate</small><strong>28%</strong><div><i style={{ width: '78%' }} /></div><em>On track</em></article>
          </div>
        </section>

        <section className="starting-faq" aria-labelledby="starting-faq-title">
          <div className="starting-faq__intro">
            <span className="starting-section__label">FAQ</span>
            <h2 id="starting-faq-title">Frequently asked questions</h2>
            <p>This route is intentionally a preview for now.</p>
          </div>
          <div className="starting-faq__items">
            {faqItems.map(([question, answer], index) => (
              <details key={question} open={index === 0}>
                <summary>{question}<span>+</span></summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="starting-final-cta" aria-label="Finance Planner preview callout">
          <div><span className="starting-section__label">Finance Planner</span><h2>Take control today. Build a clearer tomorrow.</h2></div>
          <span className="starting-cta">Open dashboard</span>
        </section>

        <footer className="starting-footer">
          <div className="starting-brand"><span className="starting-brand__mark"><WalletCards size={16} /></span><span>Finance Planner</span></div>
          <p>Starting-page preview · finance.luisbenedikt.de</p>
          <span>Private preview route</span>
        </footer>
      </div>
    </main>
  )
}

export default StartingPage
