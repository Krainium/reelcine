"use client";

  import React, { useState, useEffect, useRef } from 'react';
  import { Canvas, useFrame } from '@react-three/fiber';
  import { motion, AnimatePresence } from 'framer-motion';
  import { X, Play, Square, Download } from 'lucide-react';
  import { toast } from 'sonner';
  import * as THREE from 'three';

  const BACKEND = process.env.NEXT_PUBLIC_API_BASE || '';

  interface ProgressData {
    id: string;
    percent: number;
    downloaded: number;
    total: number;
    speed: string;
    status: string;
    filename?: string;
    thumbnailUrl?: string;
    caption?: string;
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

  export default function ReelCine() {
    const [url, setUrl] = useState('');
    const [downloadId, setDownloadId] = useState<string | null>(null);
    const [progress, setProgress] = useState<ProgressData | null>(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const eventSourceRef = useRef<EventSource | null>(null);

    interface ArchiveItem {
      id: string;
      filename: string;
      size: number;
      type: 'video' | 'image';
    }
    const [archive, setArchive] = useState<ArchiveItem[]>([]);

    useEffect(() => {
      const saved = localStorage.getItem('reelcine-archive');
      if (saved) {
        try { setArchive(JSON.parse(saved)); } catch {}
      }
    }, []);

    const addToArchive = (id: string, filename: string, size: number) => {
      const type = (filename || '').toLowerCase().endsWith('.mp4') ? 'video' : 'image';
      const item: ArchiveItem = { id, filename, size, type };
      setArchive(prev => {
        if (prev.some(a => a.id === id)) return prev;
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

    const cancelDownload = () => {
      closeSSE();
      setDownloadId(null);
      setProgress(null);
      setIsDownloading(false);
      setUrl('');
      toast('Download cleared from UI', { description: 'The server process may continue in background.' });
    };

    const startCapture = async () => {
      const trimmed = url.trim();
      if (!trimmed) { toast.error('Please enter an Instagram link'); return; }
      if (!trimmed.includes('instagram.com/')) { toast.error('Please enter a valid Instagram reel, post or TV link'); return; }
      setIsDownloading(true);
      setProgress({ id: '', percent: 0, downloaded: 0, total: 0, speed: '—', status: 'starting' });

      try {
        const res = await fetch(`${BACKEND}/api/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: trimmed }),
        });
        if (!res.ok) throw new Error('Failed to start download');
        const data = await res.json();
        const id = data.id;
        setDownloadId(id);
        closeSSE();
        const es = new EventSource(`${BACKEND}/api/progress?id=${id}`);
        eventSourceRef.current = es;
        es.onmessage = (event) => {
          try {
            const upd: ProgressData = JSON.parse(event.data);
            setProgress(upd);
            if (upd.status === 'done' || upd.status === 'error') {
              es.close();
              eventSourceRef.current = null;
              setIsDownloading(false);
              if (upd.status === 'done') {
                toast.success('Download complete', { description: upd.filename || 'Media ready for download' });
                if (id && upd.filename) addToArchive(id, upd.filename, upd.total || 0);
              } else {
                toast.error('Download failed', { description: upd.error || 'Unknown error' });
              }
            }
          } catch {}
        };
        es.onerror = () => {
          es.close();
          eventSourceRef.current = null;
          setIsDownloading(false);
          toast.error('Connection to progress stream lost');
        };
        toast.success('Capture started', { description: 'ReelCine is pulling the media...' });
      } catch (err: unknown) {
        setIsDownloading(false);
        setProgress(null);
        setDownloadId(null);
        const msg = err instanceof Error ? err.message : 'Check that the Go backend is running on port 7777';
        toast.error('Failed to start capture', { description: msg });
      }
    };

    const downloadFile = () => {
      if (!downloadId) return;
      window.location.href = `${BACKEND}/api/file?id=${downloadId}`;
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
                    placeholder="https://www.instagram.com/reel/DWLkx01iAvM/"
                  />
                  {url && (
                    <button onClick={clearLink} className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition" title="Clear link">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {url.trim() && (
                  <button onClick={clearLink} className="reel-btn whitespace-nowrap px-8 py-4 font-bold text-base rounded-2xl border border-white/20 text-white/70 hover:text-white hover:border-white/40 hover:bg-white/5 flex items-center justify-center gap-2 transition">
                    <X className="w-4 h-4" /> CANCEL
                  </button>
                )}
                <button onClick={startCapture} disabled={!url.trim() || isDownloading} className="reel-btn whitespace-nowrap px-8 py-4 font-bold text-base rounded-2xl bg-amber-400 hover:bg-amber-300 active:bg-yellow-400 disabled:opacity-60 disabled:pointer-events-none text-black flex items-center justify-center gap-2">
                  CAPTURE <Play className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-3.5 text-[10px] text-white/40 flex gap-2 items-center">
                Try: <span onClick={() => setUrl('https://www.instagram.com/reel/DWLkx01iAvM/')} className="cursor-pointer hover:text-amber-400 transition">reel/DWLkx01iAvM</span> • <span onClick={() => setUrl('https://www.instagram.com/p/DZZUdqFNyc_/')} className="cursor-pointer hover:text-amber-400 transition">post example</span>
              </div>
            </div>

            <div className={`projection-wrapper${(downloadId || progress) ? ' min-h-[480px] md:min-h-[520px]' : ''}`}>
              <AnimatePresence>
                {(downloadId || progress) && (
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
                          src={`${BACKEND}/api/thumb?id=${downloadId}`}
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
                          <div className="font-semibold text-2xl tracking-tighter mono truncate max-w-[420px]">{progress?.filename || 'PREPARING MEDIA...'}</div>
                          <div className="text-sm text-amber-400">{progress?.status}</div>
                        </div>
                        <div className="text-right text-[68px] font-semibold tabular-nums tracking-[-3.5px] leading-none text-amber-400">{Math.floor(currentPercent)}</div>
                      </div>

                      <div className="progress-track h-2.5 rounded-full overflow-hidden mb-6 border border-white/5">
                        <motion.div className="progress-fill h-2.5 rounded-full" style={{ width: `${Math.max(2, currentPercent)}%` }} animate={{ width: `${Math.max(2, currentPercent)}%` }} transition={{ duration: 0.12 }} />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 text-sm mb-7">
                        <div>
                          <div className="text-white/40 text-[10px] mb-px tracking-widest">SPEED</div>
                          <div className="mono text-xl font-medium">{progress?.speed || '—'}</div>
                        </div>
                        <div>
                          <div className="text-white/40 text-[10px] mb-px tracking-widest">PROGRESS</div>
                          <div className="mono text-xl font-medium">{(progress?.downloaded || 0) / 1024 / 1024 | 0} MB / {(progress?.total || 0) / 1024 / 1024 | 0} MB</div>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 md:justify-end items-end">
                          <button type="button" onClick={cancelDownload} className="px-6 py-2 text-sm rounded-2xl border border-purple-500/40 text-purple-400 hover:bg-purple-500/10 flex items-center gap-2 transition">
                            <Square className="w-3.5 h-3.5" /> CANCEL / CLEAR
                          </button>
                          {isComplete && (
                            <button type="button" onClick={downloadFile} className="reel-btn px-8 py-2.5 text-sm bg-purple-600 hover:bg-purple-500 active:bg-purple-800 text-white font-bold rounded-2xl flex items-center gap-2 whitespace-nowrap">
                              <Download className="w-4 h-4" /> SAVE FILE
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="text-[10px] text-white/35">Actual filename from Instagram CDN • Powered by pure Go backend on :7777</div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div id="archive" className="mb-12">
              <div className="flex items-end justify-between mb-4 px-1">
                <div>
                  <div className="section-title">HISTORY</div>
                  <div className="text-2xl font-semibold tracking-tight">Archive</div>
                </div>
                {archive.length > 0 && (
                  <button onClick={clearArchive} className="text-xs text-white/40 hover:text-white/70 transition">Clear all</button>
                )}
              </div>
              {archive.length === 0 ? (
                <div className="glass rounded-2xl p-6 text-white/50 text-sm">Completed captures will appear here. Re-download anytime.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 pb-4">
                  {archive.map((item) => (
                    <div key={item.id} onClick={() => { window.location.href = `${BACKEND}/api/file-by-name?name=${encodeURIComponent(item.filename)}`; }} className="glass rounded-2xl p-4 border border-white/10 flex-shrink-0 cursor-pointer hover:border-amber-300/40 active:scale-[0.985] transition-all">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-zinc-800 flex items-center justify-center text-lg flex-shrink-0">{item.type === 'video' ? '🎞' : '🖼'}</div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate" title={item.filename}>{item.filename}</div>
                          <div className="text-[10px] text-white/50 mono">{(item.size / 1024 / 1024).toFixed(1)} MB</div>
                        </div>
                      </div>
                      <div className="mt-3 text-[10px] text-emerald-400/80">Re-download →</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div id="features" className="mb-12">
              <div className="section-title mb-3">WHAT MAKES IT SPECIAL</div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  ['Cinematic 3D Visualization', 'Live spinning film reels in the Projection Room that react to download progress in real time.'],
                  ['Realtime SSE Progress', 'True server-pushed updates (not polling) for the progress bar, speed, and 3D viz while the Go backend downloads.'],
                  ['Actual Content Names', 'Saves files using the real caption as the filename. The caption is also used as a watermark background during capture.'],
                  ['Archive & Re-downloads', 'Completed items are saved locally and can be re-downloaded instantly from the Archive strip.'],
                  ['Desktop + Mobile', 'Fully responsive layout, touch-friendly buttons, and scaled 3D canvases that work on phones and desktops.'],
                  ['Pure Go + Same Origin', 'The entire experience (UI + API) is served from a single Go binary on one port. No external downloader dependencies.'],
                ].map(([title, desc]) => (
                  <div key={title} className="glass rounded-2xl p-5">
                    <div className="font-semibold mb-1">{title}</div>
                    <div className="text-sm text-white/60">{desc}</div>
                  </div>
                ))}
              </div>
            </div>

            <div id="api" className="mb-8">
              <div className="section-title mb-3">API</div>
              <div className="glass rounded-2xl p-6 text-sm font-mono text-xs space-y-3">
                <div><span className="text-emerald-400">POST /api/start</span>   <span className="text-white/50">{'{ "url": "..." }'} → {'{ "id": "..." }'}</span></div>
                <div><span className="text-emerald-400">GET  /api/progress?id=</span>  <span className="text-white/50">SSE stream — JSON every 160ms (percent, speed, status, filename)</span></div>
                <div><span className="text-emerald-400">GET  /api/file?id=</span>   <span className="text-white/50">serves the downloaded file</span></div>
                <div><span className="text-emerald-400">GET  /api/file-by-name?name=</span>  <span className="text-white/50">re-download from archive</span></div>
                <div><span className="text-emerald-400">GET  /api/thumb?id=</span>   <span className="text-white/50">proxied thumbnail — no CORS issues</span></div>
              </div>
            </div>
          </div>

          <div className="border-t border-white/10 py-8 text-center text-xs text-white/30">
            REELCINE • Pure Go backend with realtime SSE •{' '}
            <a href="https://github.com/Krainium/reelcine" target="_blank" rel="noopener noreferrer" className="source-link">github.com/Krainium/reelcine</a>
          </div>
        </div>
      </div>
    );
  }
  