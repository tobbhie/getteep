import { ReactNode, useState, useRef, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { getAvatarUrls } from "@teep/shared";
import { CHROME_STORE_URL, DOCS_URL, GITHUB_URL, TWITTER_URL, DISCORD_URL, HAS_CHROME_STORE_LISTING } from "./config";
import Icon from "./components/Icon";

function truncateEmail(email: string): string {
  if (!email || !email.includes("@")) return email;
  const [local, domain] = email.split("@");
  if (local.length <= 4) return `${local}@${domain}`;
  return `${local.slice(0, 4)}…@${domain}`;
}

export default function Layout({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isDashboard = location.pathname.startsWith("/dashboard");
  const isReceipt = location.pathname.startsWith("/tx");
  const isHome = location.pathname === "/";
  const hideGlobalNav = isDashboard || isReceipt;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (mobileNavOpen) document.body.classList.add("layout-mobile-nav-open");
    else document.body.classList.remove("layout-mobile-nav-open");
    return () => document.body.classList.remove("layout-mobile-nav-open");
  }, [mobileNavOpen]);

  const displayName = user?.email?.address
    ? truncateEmail(user.email.address)
    : user?.wallet?.address
      ? `${user.wallet.address.slice(0, 6)}…${user.wallet.address.slice(-4)}`
      : "Account";
  const twitterHandle = user?.twitter?.username ?? (user?.twitter as { username?: string } | undefined)?.username;
  const avatarUrls = getAvatarUrls(twitterHandle ?? displayName, displayName);
  const googlePicture = (user?.google as { picture?: string } | undefined)?.picture;
  const twitterPicture = (user?.twitter as { profile_image_url?: string } | undefined)?.profile_image_url;
  const avatarUrl = googlePicture ?? twitterPicture ?? avatarUrls.primary;

  const closeMobile = () => setMobileNavOpen(false);

  return (
    <div className="layout">
      {!hideGlobalNav && (
        <header className="layout-header layout-header--landing">
          <div className="layout-header-inner">
            <Link to="/" className="layout-logo layout-logo-with-icon">
              <span className="layout-logo-icon" aria-hidden>
                <img src="/logo.svg" alt="" width={28} height={28} className="layout-logo-img" />
              </span>
              <span>Teep</span>
            </Link>
            <nav className="layout-nav layout-nav--center layout-nav--desktop" aria-label="Main">
              <Link to="/#how-it-works">How it works</Link>
              <Link to="/leaderboard">Stats</Link>
              <Link to="/#faq">FAQ</Link>
            </nav>
            <div className="layout-header-right layout-header-right--desktop">
              {ready && authenticated ? (
                <div className="layout-user-wrap" ref={menuRef}>
                  <button
                    type="button"
                    className="layout-user-trigger"
                    onClick={() => setUserMenuOpen((o) => !o)}
                    aria-expanded={userMenuOpen}
                    aria-haspopup="true"
                  >
                    <span className="layout-user-avatar">
                      <img
                        src={avatarUrl}
                        alt=""
                        width={28}
                        height={28}
                        onError={(e) => {
                          e.currentTarget.src = avatarUrls.fallback;
                          e.currentTarget.onerror = null;
                        }}
                      />
                      <span className="layout-user-avatar-placeholder" aria-hidden>{displayName.charAt(0).toUpperCase()}</span>
                    </span>
                    <span className="layout-user-email">{displayName}</span>
                    <span className="layout-user-chevron" aria-hidden>{userMenuOpen ? "▲" : "▼"}</span>
                  </button>
                  {userMenuOpen && (
                    <div className="layout-user-menu">
                      <div className="layout-user-menu-email">{user?.email?.address || "Connected"}</div>
                      <Link to="/dashboard" className="layout-user-menu-item" onClick={() => setUserMenuOpen(false)}>
                        Dashboard
                      </Link>
                      <button type="button" onClick={() => { logout(); setUserMenuOpen(false); }} className="layout-user-menu-logout">
                        <span className="layout-user-menu-logout-icon" aria-hidden>⎋</span>
                        Log out
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                ready && (
                  <button type="button" onClick={login} className="layout-nav-btn">
                    Connect
                  </button>
                )
              )}
              <a
                href={CHROME_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="layout-cta-download"
              >
                <Icon name="puzzle" className="layout-cta-download-icon" />
                {HAS_CHROME_STORE_LISTING ? "Download Extension" : "Join Beta"}
              </a>
            </div>
            <button
              type="button"
              className="layout-nav-toggle"
              onClick={() => setMobileNavOpen((o) => !o)}
              aria-expanded={mobileNavOpen}
              aria-label="Toggle menu"
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
        <div className={`layout-mobile-menu ${mobileNavOpen ? "layout-mobile-menu--open" : ""}`} aria-hidden={!mobileNavOpen}>
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
              <Link to="/#how-it-works" onClick={closeMobile}>How it works</Link>
              <Link to="/leaderboard" onClick={closeMobile}>Stats</Link>
              <Link to="/#faq" onClick={closeMobile}>FAQ</Link>
            </nav>
            <div className="layout-mobile-menu-footer">
              {ready && authenticated ? (
                <div className="layout-mobile-menu-user">
                  <Link to="/dashboard" className="layout-mobile-menu-cta layout-mobile-menu-cta--user" onClick={closeMobile}>
                    <span className="layout-user-avatar">
                      <img src={avatarUrl} alt="" width={24} height={24} onError={(e) => { e.currentTarget.src = avatarUrls.fallback; e.currentTarget.onerror = null; }} />
                      <span className="layout-user-avatar-placeholder" aria-hidden>{displayName.charAt(0).toUpperCase()}</span>
                    </span>
                    {displayName}
                  </Link>
                  <button type="button" onClick={() => { logout(); closeMobile(); }} className="layout-mobile-menu-logout">
                    Log out
                  </button>
                </div>
              ) : (
                ready && (
                  <button type="button" onClick={() => { closeMobile(); login(); }} className="layout-mobile-menu-cta layout-mobile-menu-cta--connect">
                    Connect
                  </button>
                )
              )}
              <a
                href={CHROME_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="layout-mobile-menu-cta layout-mobile-menu-cta--download"
                onClick={closeMobile}
              >
                <Icon name="puzzle" />
                {HAS_CHROME_STORE_LISTING ? "Download Extension" : "Join Beta"}
              </a>
            </div>
          </div>
        </div>
      )}
      <main className={`layout-main ${isDashboard ? "layout-main--dashboard" : ""} ${isHome || isReceipt ? "layout-main--full" : ""}`}>
        {children}
      </main>
      {!hideGlobalNav && (
        <footer className="layout-footer">
          <div className="layout-footer-brand">
            <Link to="/" className="layout-footer-logo">Teep</Link>
            <p className="layout-footer-tagline">Non-custodial tipping protocol</p>
          </div>
          <div className="layout-footer-row">
            <div className="layout-footer-links">
              <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">Docs</a>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
              <Link to="/#developers">Developers</Link>
              <Link to="/leaderboard">Stats</Link>
            </div>
            <div className="layout-footer-social">
              <a href={TWITTER_URL} target="_blank" rel="noopener noreferrer" aria-label="Twitter">Twitter</a>
              <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" aria-label="Discord">Discord</a>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub">GitHub</a>
            </div>
          </div>
          <p className="layout-footer-copy">
            © {new Date().getFullYear()} Teep. Your money. You control it. Not affiliated with X Corp.
          </p>
        </footer>
      )}
    </div>
  );
}
