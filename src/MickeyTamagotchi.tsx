import { useState, useEffect, useRef } from 'react';
import './MickeyTamagotchi.css';

// Audio click feedback beeps
function playBeep(frequency = 800, duration = 80) {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    
    gainNode.gain.setValueAtTime(0.04, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration / 1000);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + duration / 1000);
  } catch (e) {
    console.warn("Beep audio blocked:", e);
  }
}

export function MickeyTamagotchiButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Ouvrir le Tamagotchi Mickey 1928 (Provisoire)"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        color: 'var(--idfm-navy, #1e3a8a)',
        cursor: 'pointer',
        padding: '8px',
        marginTop: '10px',
        opacity: 0.7,
        transition: 'opacity 0.2s, transform 0.2s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1.1)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.transform = 'scale(1)'; }}
    >
      <svg viewBox="0 0 100 100" width="32" height="32" style={{ display: 'block' }}>
        {/* Egg shell */}
        <path d="M 50 10 C 25 10, 15 45, 15 65 C 15 85, 30 90, 50 90 C 70 90, 85 85, 85 65 C 85 45, 75 10, 50 10 Z" fill="none" stroke="currentColor" strokeWidth="6" />
        {/* Screen boundary */}
        <rect x="30" y="35" width="40" height="30" rx="3" fill="none" stroke="currentColor" strokeWidth="4" />
        {/* Mickey Silhouette inside screen */}
        <circle cx="50" cy="52" r="8" fill="currentColor" />
        <circle cx="42" cy="44" r="5" fill="currentColor" />
        <circle cx="58" cy="44" r="5" fill="currentColor" />
        {/* Small buttons at bottom */}
        <circle cx="38" cy="78" r="3" fill="currentColor" />
        <circle cx="50" cy="80" r="3" fill="currentColor" />
        <circle cx="62" cy="78" r="3" fill="currentColor" />
      </svg>
    </button>
  );
}

export function MickeyTamagotchiModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [hunger, setHunger] = useState(80);
  const [love, setLove] = useState(80);
  const [sleep, setSleep] = useState(80);
  const [isSleeping, setIsSleeping] = useState(false);
  const [isDead, setIsDead] = useState(false);

  const [bills, setBills] = useState<{ id: number; left: string; top: string }[]>([]);
  const [floatingTexts, setFloatingTexts] = useState<{ id: number; text: string; color: string; left: string }[]>([]);

  const [bounce, setBounce] = useState(true);
  const [eating, setEating] = useState(false);
  const [spinning, setSpinning] = useState(false);

  const billIdCounter = useRef(0);
  const floatIdCounter = useRef(0);

  // Stats decay effect (every 1.5 seconds)
  useEffect(() => {
    if (!isOpen || isDead) return;

    const interval = setInterval(() => {
      if (isSleeping) {
        setSleep(s => Math.min(100, s + 5));
        setHunger(h => {
          const next = h - 1.8;
          return next <= 0 ? 0 : next;
        });
        setLove(l => {
          const next = l - 1.2;
          return next <= 0 ? 0 : next;
        });

        // Spawn little floating Zzz
        if (Math.random() > 0.4) {
          createFloatingText("z", "#1e3a8a");
        }
      } else {
        setHunger(h => {
          const next = h - 3.0;
          return next <= 0 ? 0 : next;
        });
        setLove(l => {
          const next = l - 2.4;
          return next <= 0 ? 0 : next;
        });
        setSleep(s => {
          const next = s - 1.8;
          return next <= 0 ? 0 : next;
        });
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [isOpen, isSleeping, isDead]);

  // Check death conditions
  useEffect(() => {
    if (hunger === 0 || sleep === 0) {
      setIsDead(true);
    }
  }, [hunger, sleep]);

  // Auto wake up
  useEffect(() => {
    if (isSleeping && sleep === 100) {
      setIsSleeping(false);
      createFloatingText("Debout !", "#b45309");
      playBeep(320, 180);
    }
  }, [isSleeping, sleep]);

  if (!isOpen) return null;

  const createFloatingText = (text: string, color = "#111827") => {
    const id = floatIdCounter.current++;
    const left = (40 + Math.random() * 20) + "%";
    setFloatingTexts(prev => [...prev, { id, text, color, left }]);
    setTimeout(() => {
      setFloatingTexts(prev => prev.filter(item => item.id !== id));
    }, 800);
  };

  const handleFeed = () => {
    if (isDead || isSleeping) return;
    playBeep(650, 70);
    setTimeout(() => playBeep(850, 70), 85);

    const billId = billIdCounter.current++;
    const left = (35 + Math.random() * 30) + "%";
    setBills(prev => [...prev, { id: billId, left, top: "10px" }]);

    setTimeout(() => {
      // Remove bill
      setBills(prev => prev.filter(b => b.id !== billId));

      // Eat animation
      setBounce(false);
      setEating(true);

      // Increase hunger
      setHunger(h => Math.min(100, h + 20));
      createFloatingText("+20 💵", "#047857");

      setTimeout(() => {
        setEating(false);
        setBounce(true);
      }, 500);
    }, 550);
  };

  const handlePlay = () => {
    if (isDead || isSleeping) return;
    playBeep(800, 60);
    setTimeout(() => playBeep(1100, 70), 80);

    setBounce(false);
    setSpinning(true);

    setLove(l => Math.min(100, l + 15));
    createFloatingText("+15 ❤️", "#b91c1c");

    setTimeout(() => {
      setSpinning(false);
      setBounce(true);
    }, 600);
  };

  const handleSleepToggle = () => {
    if (isDead) return;
    playBeep(320, 180);

    setIsSleeping(prev => {
      const next = !prev;
      if (next) {
        setBounce(false);
        createFloatingText("Zzz...", "#1e3a8a");
      } else {
        setBounce(true);
        createFloatingText("Debout !", "#b45309");
      }
      return next;
    });
  };

  const handleRestart = () => {
    setHunger(80);
    setLove(80);
    setSleep(80);
    setIsSleeping(false);
    setIsDead(false);
    setBounce(true);
    setEating(false);
    setSpinning(false);
    setBills([]);
    setFloatingTexts([]);
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'relative',
          padding: '24px',
          borderRadius: '28px',
          backgroundColor: 'var(--ios-card-bg, #ffffff)',
          border: '1px solid var(--ios-border, #e2e8f0)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            border: 'none',
            background: 'rgba(0,0,0,0.06)',
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--idfm-navy, #1e3a8a)',
          }}
        >
          ✕
        </button>

        {/* Console Shell */}
        <div className="tamagotchi-shell" style={{ margin: '10px 0' }}>
          <div className="tamagotchi-screen-bezel">
            <div className="screen-glass">
              {/* LCD Header Gauges */}
              <div className="lcd-header">
                <div className="lcd-gauge-group" title="Faim">
                  <span className="lcd-gauge-icon">💵</span>
                  <div className="lcd-gauge-bg">
                    <div className="lcd-gauge-fill" style={{ width: `${hunger}%` }}></div>
                  </div>
                </div>
                <div className="lcd-gauge-group" title="Bonheur">
                  <span className="lcd-gauge-icon">❤️</span>
                  <div className="lcd-gauge-bg">
                    <div className="lcd-gauge-fill" style={{ width: `${love}%` }}></div>
                  </div>
                </div>
                <div className="lcd-gauge-group" title="Sommeil">
                  <span className="lcd-gauge-icon">💤</span>
                  <div className="lcd-gauge-bg">
                    <div className="lcd-gauge-fill" style={{ width: `${sleep}%` }}></div>
                  </div>
                </div>
              </div>

              {/* LCD Display */}
              <div className={`lcd-display ${isSleeping ? 'dark-mode' : ''}`} style={{ height: '110px' }}>
                {!isDead && (
                  <div className={`pet-wrapper ${bounce ? 'pet-bounce' : ''} ${eating ? 'pet-eating' : ''} ${spinning ? 'pet-spin' : ''}`}>
                    <svg viewBox="0 0 100 100" width="60" height="60" id="mickey-svg">
                      {/* Ears */}
                      <circle cx="25" cy="30" r="18" className="mickey-black" />
                      <circle cx="75" cy="30" r="18" className="mickey-black" />
                      {/* Head */}
                      <circle cx="50" cy="60" r="28" className="mickey-black" />
                      {/* Face mask */}
                      <path d="M 50 40 C 36 40, 32 54, 34 68 C 36 78, 44 82, 50 82 C 56 82, 64 78, 66 68 C 68 54, 64 40, 50 40 Z" fill="#ede6d5" className="mickey-skin" />
                      <path d="M 50 48 C 42 48, 38 56, 38 66 C 38 72, 43 76, 50 76 C 57 76, 62 72, 62 66 C 62 56, 58 48, 50 48 Z" fill="#ede6d5" className="mickey-skin" />
                      {/* Eyes */}
                      <ellipse cx="44" cy="56" rx="4" ry={isSleeping ? 1 : 9} className="mickey-eye" />
                      <ellipse cx="56" cy="56" rx="4" ry={isSleeping ? 1 : 9} className="mickey-eye" />
                      {/* Nose */}
                      <ellipse cx="50" cy="67" rx="5.5" ry="3.2" className="mickey-black" />
                      {/* Mouth */}
                      <path
                        d={isSleeping ? "M 46 73 Q 50 75 54 73" : eating ? "M 45 74 Q 50 82 55 74" : "M 40 71 Q 50 77 60 71"}
                        stroke="#111"
                        strokeWidth="2.5"
                        fill="none"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>
                )}

                {/* Floating Zzz / text */}
                {floatingTexts.map(f => (
                  <div key={f.id} className="floating-text" style={{ color: f.color, left: f.left }}>
                    {f.text}
                  </div>
                ))}

                {/* Falling dollar bills */}
                {bills.map(b => (
                  <div key={b.id} className="dollar-bill" style={{ left: b.left, top: b.top }}>
                    💵
                  </div>
                ))}

                {/* Overlays */}
                {isSleeping && <div id="lcd-sleeping-indicator">Zzz...</div>}
                {isDead && (
                  <div id="lcd-death">
                    ☠️ RIP<br />Mickey (1928-2026)
                    <button
                      onClick={handleRestart}
                      style={{
                        marginTop: '8px',
                        padding: '2px 8px',
                        fontSize: '9px',
                        borderRadius: '4px',
                        border: '1px solid #111',
                        background: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      Restart
                    </button>
                  </div>
                )}
                {hunger <= 25 && !isDead && !isSleeping && <div id="lcd-alert">⚠️ FAIM !</div>}
              </div>
            </div>
          </div>

          {/* Physical Buttons */}
          <div className="shell-buttons">
            <div className="btn-group">
              <button id="t-btn-a" className="physical-btn btn-feed" title="Nourrir (Dollars)" onClick={handleFeed}></button>
              <span className="btn-tag">NOURRIR</span>
            </div>
            <div className="btn-group">
              <button id="t-btn-b" className="physical-btn btn-play" title="Jouer" onClick={handlePlay}></button>
              <span className="btn-tag">JOUER</span>
            </div>
            <div className="btn-group">
              <button id="t-btn-c" className="physical-btn btn-sleep" title="Sommeil / Réveil" onClick={handleSleepToggle}></button>
              <span className="btn-tag">SOMMEIL</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
