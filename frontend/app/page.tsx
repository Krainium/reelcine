"use client";

  import React, { useState, useEffect, useRef } from 'react';
  import { Canvas, useFrame } from '@react-three/fiber';
  import { motion, AnimatePresence } from 'framer-motion';
  import { X, Play, Download } from 'lucide-react';
  import { toast } from 'sonner';
  import * as THREE from 'three';

  interface ProgressData {
    id?: string;
    percent: number;
    downloaded: number;
    total: number;
    speed: string;
    status: string;
    filename?: string;
    thumbnailUrl?: string;
    caption?: string;
    cdnUrl?: string;
    error?: string;
  }

  function CinematicReel({ progress = 0, isSpinning = true, scale = 1, color = '#222222' }: { progress?: number; isSpinning?: boolean; scale?: number; color?: string; }) {
    const reelRef = React.useRef<THREE.Group>(null!);
    const particlesRef = React.useRef<THREE.Points>(null!);

    useFrame((state, delta) => {
      if (reelRef.current) {
        const spinSpeed = isSpinning ? 0.8 + (progress / 120) : 0.15;
        reelRef.current.rotation.y += delta * spinSpeed;
        reelRef.current.position.y = Math.sin(state.clock.elapsedTime * 1.2) * 0.15;
      }
      if (particlesRef.current) {
        particlesRef.current.rotation.y = state.clock.elapsedTime * 0.3;
        (particlesRef.current.material as THREE.PointsMaterial).size = 0.06 + (progress / 1800);
      }
    });

    return (
      <group>
        <group ref={reelRef} scale={scale}>
          <mesh>
            <cylinderGeometry args={[1.9, 1.9, 0.7, 48, 1, true]} />
            <meshPhongMaterial color={color} emissive="#0a0a0a" shininess={18} side={THREE.DoubleSide} />
          </mesh>
          <mesh>
            <cylinderGeometry args={[0.9, 0.9, 0.85, 32]} />
            <meshPhongMaterial color="#111111" shininess={30} />
          </mesh>
          {Array.from({ length: 8 }).map((_, i) => (
            <mesh key={i} position={[1.65 * Math.cos((i / 8) * Math.PI * 2), 0, 1.65 * Math.sin((i / 8) * Math.PI * 2)]} rotation={[0, (i / 8) * Math.PI * 2, 0]}>
              <boxGeometry args={[0.18, 0.45, 0.12]} />
              <meshPhongMaterial color="#1a1a1a" />
            </mesh>
          ))}
        </group>
        <points ref={particlesRef}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[new Float32Array(Array.from({ length: 52 * 3 }, () => (Math.random() - 0.5) * 9)), 3]} />
          </bufferGeometry>
          <pointsMaterial size={0.07} color="#f59e0b" transparent opacity={0.55} />
        </points>
      </group>
    );
  }

  interface ArchiveItem {
    id: string;
    filename: string;
    size: number;
    type: 'video' | 'image';
    cdnUrl?: string;
  }

  export default function ReelCine() {
    const [url, setUrl] = useState('');
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [cdnUrl, setCdnUrl] = useState<string | null>(null);
    const [progress, setProgress] = useState<ProgressData | null>(null);
    const [isCapturing, setIsCapturing] = useState(false);
    const eventSourceRef = useRef<EventSource | null>(null);
    const [archive, setArchive] = useState<ArchiveItem[]>([]);

    useEffect(() => {
      const saved = localStorage.getItem('reelcine-archive');
      if (saved) {
        try { setArchive(JSON.parse(saved)); } catch {}
      }
    }, []);

    const addToArchive = (filename: string, cdn: string) => {
      const type: 'video' | 'image' = filename.toLowerCase().endsWith('.mp4') ? 'video' : 'image';
      const item: ArchiveItem = { id: Date.now().toString(36), filename, size: 0, type, cdnUrl: cdn };
      setArchive(prev => {
        if (prev.some(a => a.filename === filename)) return prev;
        const updated = [...prev, item].slice(-10);
        localStorage.setItem('reelcine-archive', JSON.stringify(updated));
        return updated;
      });
    };

    const clearArchive = () => {
      setArchive([]);
      localStorage.removeItem('reelcine-archive');
      toast.info('Archive cleared');
    };

    const closeSSE = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };

    const clearLink = () => {
      setUrl('');
      toast.info('Link cleared');
    };

    const cancelCapture = () => {
      closeSSE();
      setSessionId(null);
      setCdnUrl(null);
      setProgress(null);
      setIsCapturing(false);
      setUrl('');
      toast('Capture cancelled');
    };

    const startCapture = () => {
      const trimmed = url.trim();
      if (!trimmed) { toast.error('Please enter an Instagram link'); return; }
      if (!trimmed.includes('instagram.com/')) { toast.error('Please enter a valid Instagram reel, post or TV link'); return; }

      setIsCapturing(true);
      setCdnUrl(null);
      const sid = Math.random().toString(36).slice(2);
      setSessionId(sid);
      setProgress({ percent: 0, downloaded: 0, total: 0, speed: '—', status: 'starting' });

      closeSSE();
      const es = new EventSource(`/api/capture?url=${encodeURIComponent(trimmed)}`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const upd: ProgressData = JSON.parse(event.data);
          setProgress(upd);
          if (upd.cdnUrl) setCdnUrl(upd.cdnUrl);
          if (upd.status === 'done' || upd.status === 'error') {
            es.close();
            eventSourceRef.current = null;
            setIsCapturing(false);
            if (upd.status === 'done') {
              toast.success('Capture complete', { description: upd.filename || 'Media ready for download' });
              if (upd.filename && upd.cdnUrl) addToArchive(upd.filename, upd.cdnUrl);
            } else {
              toast.error('Capture failed', { description: upd.error || 'Unknown error' });
            }
          }
        } catch {}
      };

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        setIsCapturing(false);
        toast.error('Capture stream lost — please try again');
      };

      toast.success('Capture started', { description: 'ReelCine is pulling the media...' });
    };

    const downloadFile = () => {
      if (!cdnUrl || !progress?.filename) return;
      window.location.href = `/api/proxy?url=${encodeURIComponent(cdnUrl)}&name=${encodeURIComponent(progress.filename)}`;
    };

    const redownloadArchive = (item: ArchiveItem) => {
      if (!item.cdnUrl) { toast.error('CDN link expired — re-capture the original URL'); return; }
      window.location.href = `/api/proxy?url=${encodeURIComponent(item.cdnUrl)}&name=${encodeURIComponent(item.filename)}`;
    };

    useEffect(() => { return () => closeSSE(); }, []);

    const currentPercent = progress?.percent || 0;
    const isComplete = progress?.status === 'done';
    const hasError = progress?.status === 'error';

    return (
      <div className="min-h-screen dark-cinematic film-grain">
        <div className="relative z-10">
          <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#050505]/95 backdrop-blur-xl">
            <div className="max-w-6xl mx-auto px-8 flex items-center justify-between h-20">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center text-black font-bold text-3xl leading-none pt-px">R</div>
                <div>
                  <div className="cinematic-font text-3xl font-semibold tracking-[-2.8px]">REELCINE</div>
                  <div className="text-[9px] -mt-1 text-amber-400/70 tracking-[3.5px]">REALTIME SSE</div>
                </div>
              </div>
              <div className="flex items-center gap-3 md:gap-6 text-xs md:text-sm font-medium">
                <a href="#home" className="hover:text-amber-400 transition-colors">Home</a>
                <a href="#features" className="hover:text-amber-400 transition-colors">Features</a>
                <a href="#api" className="hover:text-amber-400 transition-colors">API</a>
              </div>
            </div>
          </nav>

          <div className="max-w-5xl mx-auto px-8 pt-14 pb-20">
            <div id="home" className="max-w-3xl mb-12">
              <h1 className="cinematic-font text-7xl font-semibold tracking-tighter leading-[.88]">Real-time extraction.</h1>
              <p className="mt-5 text-2xl text-zinc-400 max-w-md">Download Instagram Reels, Posts and TV with rich 3D visuals and live progress.</p>
            </div>

            <div className="glass rounded-3xl p-9 mb-9">
              <div className="flex items-end justify-between mb-7">
                <div>
                  <div className="section-title">LIVE CAPTURE</div>
                  <div className="text-4xl font-semibold tracking-tighter mt-1">Paste Instagram Link</div>
                </div>
                <div className="text-right text-xs text-white/40 leading-none">Supports<br />video &amp; photo</div>
              </div>

              <div className="relative flex flex-col sm:flex-row gap-3">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') startCapture(); }}
                    className="input w-full px-6 py-4 rounded-2xl text-lg placeholder:text-white/30 font-light"
                    placeholder="https://www.instagram.com/reels/DZafF3uNUFY/"
                  />
                  {url && (
                    <button onClick={clearLink} className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition" title="Clear link">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {isCapturing && (
                  <button onClick={cancelCapture} className="reel-btn whitespace-nowrap px-8 py-4 font-bold text-base rounded-2xl border border-white/20 text-white/70 hover:text-white hover:border-white/40 hover:bg-white/5 flex items-center justify-center gap-2 transition">
                    <X className="w-4 h-4" /> CANCEL
                  </button>
                )}
                <button onClick={startCapture} disabled={!url.trim() || isCapturing} className="reel-btn whitespace-nowrap px-8 py-4 font-bold text-base rounded-2xl bg-amber-400 hover:bg-amber-300 active:bg-yellow-400 disabled:opacity-60 disabled:pointer-events-none text-black flex items-center justify-center gap-2">
                  CAPTURE <Play className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-3.5 text-[10px] text-white/40 flex gap-2 items-center flex-wrap">
                Try:
                <span onClick={() => setUrl('https://www.instagram.com/reels/DZafF3uNUFY/')} className="cursor-pointer hover:text-amber-400 transition">reels/DZafF3uNUFY</span>
                •
                <span onClick={() => setUrl('https://www.instagram.com/p/DZZUdqFNyc_/')} className="cursor-pointer hover:text-amber-400 transition">post example</span>
              </div>
            </div>

            <div className={`projection-wrapper${(sessionId || progress) ? ' min-h-[480px] md:min-h-[520px]' : ''}`}>
              <AnimatePresence>
                {(sessionId || progress) && (
                  <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="glass rounded-3xl overflow-hidden border border-white/10">
                    <div className="flex items-center justify-between px-9 pt-7 pb-4 border-b border-white/10">
                      <div className="section-title">PROJECTION ROOM — REALTIME</div>
                      <div className={`mono text-xs px-3 py-1 rounded ${hasError ? 'bg-red-500/10 text-red-400' : isComplete ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-400/10 text-amber-400'}`}>
                        {progress?.status?.toUpperCase() || 'CAPTURING'}
                      </div>
                    </div>

                    <div className={`relative h-[180px] md:h-[232px] bg-[#0a0a0a] flex items-center justify-center film-grain overflow-hidden ${(progress?.filename || '').toLowerCase().endsWith('.mp4') ? 'media-video-bg' : 'media-image-bg'}`}>
                      {progress?.filename && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
                          <div className="text-[2.8rem] md:text-[4.2rem] font-mono tracking-[5px] opacity-[0.06] select-none whitespace-nowrap" style={{ transform: 'rotate(-7deg)' }}>
                            {progress.filename}
                          </div>
                        </div>
                      )}
                      {progress?.thumbnailUrl && (
                        <img
                          src={`/api/thumb?url=${encodeURIComponent(progress.thumbnailUrl)}`}
                          alt="preview"
                          className="absolute inset-0 w-full h-full object-cover opacity-35"
                          style={{ zIndex: 1 }}
                        />
                      )}
                      <Canvas camera={{ position: [0, 0.8, 13], fov: 52 }} style={{ width: '100%', height: '100%', position: 'relative', zIndex: 10 }}>
                        <ambientLight intensity={0.7} />
                        <directionalLight position={[8, 14, 18]} intensity={1.3} color="#fff0c2" />
                        <CinematicReel progress={currentPercent} isSpinning={!isComplete && !hasError} scale={1.15} />
                      </Canvas>
                      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/70 to-transparent z-10" />
                    </div>

                    <div className="p-9 bg-[#0a0a0a]">
                      <div className="flex items-baseline justify-between mb-2">
                        <div>
                          <div className="mono text-xs text-white/50 mb-1">{progress?.filename || '—'}</div>
                          {progress?.caption && <div className="text-sm text-white/60 italic truncate max-w-xs">"{progress.caption}"</div>}
                        </div>
                        <div className="text-right mono text-xs text-white/40 space-y-px">
                          <div>{currentPercent.toFixed(0)}%</div>
                        </div>
                      </div>

                      <div className="relative h-1.5 bg-white/10 rounded-full overflow-hidden mb-6">
                        <motion.div className="absolute inset-y-0 left-0 bg-amber-400 rounded-full" animate={{ width: `${currentPercent}%` }} transition={{ duration: 0.3, ease: 'easeOut' }} />
                      </div>

                      <div className="flex gap-3">
                        {isComplete && cdnUrl && (
                          <button onClick={downloadFile} className="reel-btn flex-1 py-4 bg-amber-400 hover:bg-amber-300 active:bg-yellow-400 text-black font-bold rounded-2xl flex items-center justify-center gap-2">
                            <Download className="w-4 h-4" /> SAVE FILE
                          </button>
                        )}
                        {(isCapturing || isComplete || hasError) && (
                          <button onClick={cancelCapture} className="reel-btn py-4 px-6 border border-white/20 hover:border-white/40 rounded-2xl text-white/60 hover:text-white text-sm transition flex items-center gap-2">
                            <X className="w-4 h-4" /> {isComplete ? 'CLEAR' : 'CANCEL'}
                          </button>
                        )}
                      </div>

                      {hasError && (
                        <div className="mt-4 text-sm text-red-400 bg-red-500/10 rounded-xl px-4 py-3">{progress?.error}</div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div id="features" className="mt-12 mb-10">
              <div className="section-title mb-6">CAPABILITIES</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { icon: '🎞', title: '3D capture room', desc: 'Three.js film reel spins live during extraction.' },
                  { icon: '📡', title: 'Live SSE', desc: 'True server push via EventSource — no polling.' },
                  { icon: '🖼', title: 'Thumbnail preview', desc: 'Post thumbnail shown behind the 3D scene.' },
                  { icon: '💾', title: 'Caption filenames', desc: 'Files saved as caption_shortcode.mp4, not hashes.' },
                  { icon: '📂', title: 'Archive', desc: 'Last 10 captures stored locally, re-download anytime.' },
                  { icon: '⚡', title: 'Serverless', desc: 'Fully hosted on Vercel — no VPS required.' },
                ].map(f => (
                  <div key={f.title} className="glass rounded-2xl p-6 border border-white/5">
                    <div className="text-2xl mb-3">{f.icon}</div>
                    <div className="font-semibold mb-1">{f.title}</div>
                    <div className="text-sm text-white/50">{f.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            <div id="api" className="glass rounded-3xl p-9 mb-9">
              <div className="section-title mb-5">API REFERENCE</div>
              <div className="space-y-3 mono text-sm">
                {[
                  { method: 'GET', path: '/api/capture?url=', desc: 'SSE stream — extracts media URL (percent, status, cdnUrl)' },
                  { method: 'GET', path: '/api/proxy?url=&name=', desc: 'Streams the media file from CDN through Vercel edge' },
                  { method: 'GET', path: '/api/thumb?url=', desc: 'Proxied thumbnail — avoids browser CORS restrictions' },
                ].map(e => (
                  <div key={e.path} className="flex flex-col sm:flex-row gap-2 sm:gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/5">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded w-fit ${e.method === 'POST' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}`}>{e.method}</span>
                    <span className="text-white/80 font-medium">{e.path}</span>
                    <span className="text-white/40 text-xs self-center">{e.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {archive.length > 0 && (
              <div className="glass rounded-3xl p-9">
                <div className="flex items-center justify-between mb-6">
                  <div className="section-title">ARCHIVE</div>
                  <button onClick={clearArchive} className="text-xs text-white/40 hover:text-white/70 transition">Clear all</button>
                </div>
                <div className="space-y-2">
                  {archive.map(item => (
                    <div key={item.id} onClick={() => redownloadArchive(item)} className="flex items-center gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-amber-400/20 hover:bg-white/[0.06] cursor-pointer transition group">
                      <span className="text-xl">{item.type === 'video' ? '🎬' : '🖼'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{item.filename}</div>
                        <div className="text-xs text-white/40">{item.type}</div>
                      </div>
                      <Download className="w-4 h-4 text-white/20 group-hover:text-amber-400 transition" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  