import { ReactNode, useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { DOCS_URL, GITHUB_URL, TWITTER_URL, DISCORD_URL } from "./config";

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const isCreatorDashboard =
    location.pathname === "/creator/dashboard" ||
    location.pathname === "/creator/withdraw" ||
    location.pathname === "/creator/settings" ||
    location.pathname === "/creator/referrals" ||
    location.pathname === "/creator/performance" ||
    location.pathname.startsWith("/creator/grow/");
  const isDashboard = location.pathname.startsWith("/dashboard") || isCreatorDashboard;
  const isReceipt = location.pathname.startsWith("/tx");
  const isHome = location.pathname === "/";
  const isTipPost = location.pathname.startsWith("/t/");
  const isOps = location.pathname.startsWith("/ops");
  const isXIntentPage = location.pathname === "/register" || location.pathname === "/fund" || location.pathname.startsWith("/x/");
  const isPublicProfile =
    location.pathname.startsWith("/profile/") ||
    location.pathname.startsWith("/tipper/") ||
    location.pathname.startsWith("/u/") ||
    (location.pathname.startsWith("/creator/") && !isCreatorDashboard);
  const isPublicWide = location.pathname === "/leaderboard" || isPublicProfile || isTipPost || isXIntentPage;
  const isUtilityPage = ["/fees", "/privacy", "/support", "/terms"].includes(location.pathname);
  const hideGlobalNav = isDashboard || isReceipt || isOps || location.pathname.startsWith("/profile/tipper/") || location.pathname.startsWith("/tipper/");

  useEffect(() => {
    if (!mobileNavOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.classList.add("layout-mobile-nav-open");
    document.body.style.overflow = "hidden";
    const panel = mobileMenuRef.current;
    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = panel ? Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)) : [];
    focusable[0]?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileNavOpen(false);
        return;
      }
      if (event.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove("layout-mobile-nav-open");
      document.body.style.overflow = previousOverflow;
      mobileToggleRef.current?.focus();
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (hideGlobalNav) {
      setHeaderScrolled(false);
      return;
    }
    const updateHeader = () => setHeaderScrolled(window.scrollY > 12);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    return () => window.removeEventListener("scroll", updateHeader);
  }, [hideGlobalNav]);

  const closeMobile = () => setMobileNavOpen(false);
  const focusHashTarget = (hash: string) => {
    if (typeof window === "undefined") return;
    window.setTimeout(() => {
      const id = hash.replace(/^#/, "");
      const target = document.getElementById(id);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }, 0);
  };
  const handleHashLinkClick = (hash: string) => {
    closeMobile();
    if (location.pathname === "/" && location.hash === hash) focusHashTarget(hash);
  };

  useEffect(() => {
    if (!location.hash) return;
    focusHashTarget(location.hash);
  }, [location.pathname, location.hash]);

  return (
    <div className={`layout ${isHome ? "layout--lp" : ""} ${!hideGlobalNav ? "layout--public-shell" : ""} ${isUtilityPage ? "layout--utility" : ""}`}>
      <a className="layout-skip-link" href="#main-content">Skip to content</a>
      {!hideGlobalNav && (
        <header className={`layout-header layout-header--landing ${headerScrolled ? "layout-header--scrolled" : ""}`}>
          <div className="layout-header-inner">
            <Link to="/" className="layout-logo layout-logo-with-icon">
              <span className="layout-logo-icon" aria-hidden>
                <img src="/logo.svg" alt="" width={28} height={28} className="layout-logo-img" />
              </span>
              <span>Teep</span>
            </Link>
            <nav className="layout-nav layout-nav--center layout-nav--desktop" aria-label="Main">
              <Link to="/#product" onClick={() => handleHashLinkClick("#product")}>Product</Link>
              <Link to="/#how-it-works" onClick={() => handleHashLinkClick("#how-it-works")}>How it works</Link>
              <Link to="/#activity" onClick={() => handleHashLinkClick("#activity")}>Live Activity</Link>
              <Link to="/#faq" onClick={() => handleHashLinkClick("#faq")}>FAQ</Link>
            </nav>
            <div className="layout-header-right layout-header-right--desktop">
              <a href="/dashboard" target="_blank" rel="noopener noreferrer" className="layout-home-dashboard">Launch App</a>
            </div>
            <button
              ref={mobileToggleRef}
              type="button"
              className="layout-nav-toggle"
              onClick={() => setMobileNavOpen((o) => !o)}
              aria-expanded={mobileNavOpen}
              aria-controls="layout-mobile-menu"
              aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
            >
              <span className="layout-nav-toggle-bar" />
              <span className="layout-nav-toggle-bar" />
              <span className="layout-nav-toggle-bar" />
            </button>
          </div>
        </header>
      )}

      {/* Mobile menu overlay: logo + X, then navs, then CTAs */}
      {!hideGlobalNav && (
        <div
          ref={mobileMenuRef}
          id="layout-mobile-menu"
          className={`layout-mobile-menu ${mobileNavOpen ? "layout-mobile-menu--open" : ""}`}
          aria-hidden={!mobileNavOpen}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          <div className="layout-mobile-menu-inner">
            <div className="layout-mobile-menu-header">
              <Link to="/" className="layout-logo layout-logo-with-icon" onClick={closeMobile}>
                <span className="layout-logo-icon" aria-hidden>
                  <img src="/logo.svg" alt="" width={28} height={28} className="layout-logo-img" />
                </span>
                <span>Teep</span>
              </Link>
              <button
                type="button"
                className="layout-mobile-menu-close"
                onClick={closeMobile}
                aria-label="Close menu"
              >
                <span className="layout-mobile-menu-close-x" aria-hidden>×</span>
              </button>
            </div>
            <nav className="layout-mobile-menu-nav" aria-label="Main">
              <Link to="/#product" onClick={() => handleHashLinkClick("#product")}>Product</Link>
              <Link to="/#how-it-works" onClick={() => handleHashLinkClick("#how-it-works")}>How it works</Link>
              <Link to="/#activity" onClick={() => handleHashLinkClick("#activity")}>Live Activity</Link>
              <Link to="/#faq" onClick={() => handleHashLinkClick("#faq")}>FAQ</Link>
            </nav>
            <div className="layout-mobile-menu-footer">
              <a href="/dashboard" target="_blank" rel="noopener noreferrer" className="layout-mobile-menu-cta layout-mobile-menu-cta--connect" onClick={closeMobile}>
                Launch App
              </a>
            </div>
          </div>
        </div>
      )}
      <main id="main-content" tabIndex={-1} className={`layout-main ${isDashboard ? "layout-main--dashboard" : ""} ${isHome || isReceipt || isPublicWide || isOps ? "layout-main--full" : ""}`}>
        {children}
      </main>
      {!hideGlobalNav && (
        <footer className="lp-footer">
          <div className="lp-footer-top">
            <div className="lp-footer-brand-col">
              <Link to="/" className="lp-footer-wordmark" aria-label="Teep home">
                <img src="/logo.svg" alt="" width={31} height={31} />
                <span>Teep</span>
              </Link>
              <p className="lp-footer-build">Social finance for creators and communities.</p>
              <div className="lp-footer-social">
                <a href={TWITTER_URL} target="_blank" rel="noopener noreferrer">Twitter</a>
                <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">Discord</a>
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
              </div>
            </div>
            <div className="lp-footer-cols">
              <div className="lp-footer-col">
                <h4>Product</h4>
                <Link to="/#product" onClick={() => handleHashLinkClick("#product")}>Product</Link>
                <Link to="/#how-it-works" onClick={() => handleHashLinkClick("#how-it-works")}>How it works</Link>
                <Link to="/#stats" onClick={() => handleHashLinkClick("#stats")}>Stats</Link>
                <Link to="/#faq" onClick={() => handleHashLinkClick("#faq")}>FAQ</Link>
                <Link to="/fees">Fees</Link>
              </div>
              <div className="lp-footer-col">
                <h4>Creators</h4>
                <a href="/dashboard" target="_blank" rel="noopener noreferrer">Dashboard</a>
                <Link to="/support">Support</Link>
              </div>
              <div className="lp-footer-col">
                <h4>Resources</h4>
                <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">Docs</a>
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
                <Link to="/support">Support</Link>
              </div>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span>© {new Date().getFullYear()} Teep. Your money. You control it. Not affiliated with any platform Teep supports.</span>
            <div className="lp-footer-legal">
              <Link to="/terms">Terms of Service</Link>
              <Link to="/privacy">Privacy Policy</Link>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
