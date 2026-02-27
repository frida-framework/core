
import { readFile, writeFile } from '../lib/mapper-utils';
import fs from 'node:fs';

// === COLOR THEME DATA ===

// Moto Style Orange Accent Replacements (replacing Indigo/Blue)
export const motoColorReplacements: [RegExp, string][] = [
  // Primary indigo colors -> orange
  [/bg-indigo-600/g, 'bg-orange-600'],
  [/bg-indigo-500/g, 'bg-orange-500'],
  [/bg-indigo-700/g, 'bg-orange-700'],
  [/hover:bg-indigo-600/g, 'hover:bg-orange-600'],
  [/hover:bg-indigo-500/g, 'hover:bg-orange-500'],
  [/hover:bg-indigo-700/g, 'hover:bg-orange-700'],
  [/border-indigo-500/g, 'border-orange-500'],
  [/border-indigo-600/g, 'border-orange-600'],
  [/text-indigo-400/g, 'text-orange-400'],
  [/text-indigo-500/g, 'text-orange-500'],
  [/text-indigo-600/g, 'text-orange-600'],
  [/ring-indigo-500/g, 'ring-orange-500'],
  [/focus-within:ring-indigo-500/g, 'focus-within:ring-orange-500'],
  [/focus-within:border-indigo-500/g, 'focus-within:border-orange-500'],
  [/shadow-indigo-900/g, 'shadow-orange-900'],
  [/from-indigo-600/g, 'from-orange-600'],
  [/to-violet-600/g, 'to-amber-600'],

  // Explicit Blue replacements
  [/bg-blue-500/g, 'bg-orange-500'],
  [/bg-blue-600/g, 'bg-orange-600'],
  [/text-blue-400/g, 'text-orange-400'],
  [/text-blue-500/g, 'text-orange-500'],
  [/border-blue-500/g, 'border-orange-500'],
  [/hover:bg-blue-500/g, 'hover:bg-orange-500'],
  [/hover:bg-blue-600/g, 'hover:bg-orange-600'],
  [/bg-blue-400/g, 'bg-orange-400'],

  // Replace any remaining indigo with orange
  [/indigo/g, 'orange'],
];

// Slate (Blue-Grey) -> Moto Neutral Grey Replacements
export const motoSlateReplacements: [RegExp, string][] = [
  // Backgrounds: Slate (blue-grey) -> Moto Hex (neutral/warm grey)
  [/bg-slate-950/g, 'bg-[#0B0C10]'], // App Base
  [/bg-slate-900/g, 'bg-[#15171C]'], // Inset/Darker
  [/bg-slate-800/g, 'bg-[#242830]'], // Surface
  [/bg-slate-700/g, 'bg-[#242830]'], // Fallback surface

  // Borders: Neutralize blue tint
  [/border-slate-800/g, 'border-white/5'],
  [/border-slate-700/g, 'border-white/5'],
  [/border-slate-600/g, 'border-white/5'],
];

// === FUNCTIONS ===

/**
 * Applies Moto Style color theme (Orange accent, Neutral darks) to component code
 */
export function applyMotoTheme(content: string): string {
  let processed = content;

  // Apply Orange Accent
  for (const [pattern, replacement] of motoColorReplacements) {
    processed = processed.replace(pattern, replacement);
  }

  // Apply Slate Neutralization
  for (const [pattern, replacement] of motoSlateReplacements) {
    processed = processed.replace(pattern, replacement);
  }

  return processed;
}

/**
 * Patches ComplexityBadge.tsx to use Contract HEX colors
 */
export function patchComplexityBadge(badgePath: string) {
  if (fs.existsSync(badgePath)) {
    let badgeContent = readFile(badgePath);

    // Replace EASY color
    badgeContent = badgeContent.replace(
      /case SegmentComplexity\.EASY:\s+colorClass = 'bg-emerald-500\/20 text-emerald-300 border-emerald-500\/30';/g,
      "case SegmentComplexity.EASY:\n      colorClass = 'bg-[#9CA3AF]/20 text-[#9CA3AF] border-[#9CA3AF]/30';"
    );
    // Replace MODERATE color
    badgeContent = badgeContent.replace(
      /case SegmentComplexity\.MODERATE:\s+colorClass = 'bg-yellow-500\/20 text-yellow-300 border-yellow-500\/30';/g,
      "case SegmentComplexity.MODERATE:\n      colorClass = 'bg-[#60A5FA]/20 text-[#60A5FA] border-[#60A5FA]/30';"
    );
    // Replace HARD color
    badgeContent = badgeContent.replace(
      /case SegmentComplexity\.HARD:\s+colorClass = 'bg-orange-500\/20 text-orange-300 border-orange-500\/30';/g,
      "case SegmentComplexity.HARD:\n      colorClass = 'bg-[#3B82F6]/20 text-[#3B82F6] border-[#3B82F6]/30';"
    );
    // Replace EXTREME color
    badgeContent = badgeContent.replace(
      /case SegmentComplexity\.EXTREME:\s+colorClass = 'bg-red-600\/20 text-red-400 border-red-600\/30';/g,
      "case SegmentComplexity.EXTREME:\n      colorClass = 'bg-[#8B5CF6]/20 text-[#8B5CF6] border-[#8B5CF6]/30';"
    );

    writeFile(badgePath, badgeContent);
  }
}

/**
 * Patches getSegmentColor helper in main component
 */
export function patchSegmentColorFn(content: string): string {
  let processed = content;
  processed = processed.replace(
    /case SegmentComplexity\.EASY: return 'bg-emerald-500';/g,
    "case SegmentComplexity.EASY: return 'bg-[#9CA3AF]';"
  );
  processed = processed.replace(
    /case SegmentComplexity\.MODERATE: return 'bg-yellow-500';/g,
    "case SegmentComplexity.MODERATE: return 'bg-[#60A5FA]';"
  );
  processed = processed.replace(
    /case SegmentComplexity\.HARD: return 'bg-orange-500';/g,
    "case SegmentComplexity.HARD: return 'bg-[#3B82F6]';"
  );
  processed = processed.replace(
    /case SegmentComplexity\.EXTREME: return 'bg-red-500';/g,
    "case SegmentComplexity.EXTREME: return 'bg-[#8B5CF6]';"
  );
  return processed;
}

// === TEMPLATES ===

// UI for the Loading/Skeleton State
export const loadingUITemplate = `
  // Skeleton Loading State - VARIANT A: Map fullscreen + overlay loading
  const isLoading = !routeMeta || (routeMeta.details_status === 'running' && points.length === 0);
  const showRetry = isTimedOut || routeMeta?.details_status === 'error';
  
  if (isLoading || (points.length === 0 && routeMeta)) {
    const originName = routeMeta?.origin?.label || 'Origen';
    const destinationName = routeMeta?.destination?.label || 'Destino';
    const hasError = routeMeta?.details_status === 'error' || routeMeta?.details_error;
    
    return (
      <div className="h-screen w-screen overflow-hidden relative bg-[#0B0C10] text-slate-200">
        {/* FULLSCREEN MAP - Base Layer (even during loading) */}
        <div className="absolute inset-0 z-0">
          <ErrorBoundary fallback={<div className="w-full h-full flex items-center justify-center text-slate-500">Map Error</div>}>
            <MapComponent polyline={[]} waypoints={[]} />
          </ErrorBoundary>
        </div>

        {/* LOADING OVERLAY - Left Panel with Glassmorphism */}
        <div className="absolute left-0 top-0 bottom-0 z-20 w-[380px] flex flex-col pointer-events-none">
          <div style={{ backdropFilter: 'blur(3px)' }} className="flex-1 overflow-y-auto overflow-x-hidden pointer-events-auto bg-[#0B0C10]/20 border-r border-white/5">
            <div className="relative">
              {/* Search Header - Sticky (identical to main timeline) */}
              <div style={{ backdropFilter: 'blur(3px)' }} className="sticky top-0 z-40 p-4 pb-2 bg-[#0B0C10]/30 border-b border-white/5">
                <div className={\`transition-all duration-300 \${isSearchExpanded ? 'bg-[#15171C]/50 border border-white/5 shadow-xl rounded-2xl p-3' : 'bg-transparent'}\`}>
                  <div className="relative flex items-center">
                    <div className="relative w-full flex items-center bg-[#15171C]/20 border border-white/5 rounded-full overflow-hidden shadow-lg backdrop-blur-sm">
                      <input 
                        type="text"
                        placeholder="Search route..."
                        value={searchQuery}
                        onFocus={() => setIsSearchExpanded(true)}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-transparent text-slate-200 placeholder-slate-400 px-4 py-2.5 pr-10 outline-none text-sm"
                      />
                      <button className="absolute right-1 top-1 bottom-1 aspect-square bg-orange-600/90 rounded-full flex items-center justify-center text-white hover:bg-orange-500 transition-colors"><Search size={14} /></button>
                    </div>
                    {isSearchExpanded && (
                      <button onClick={() => setIsSearchExpanded(false)} className="ml-2 text-slate-400 hover:text-white transition-colors"><X size={18} /></button>
                    )}
                  </div>
                  {isSearchExpanded && (
                    <div className="mt-2 flex gap-1 bg-[#15171C]/20 p-1 rounded-xl border border-white/5">
                      {['city', 'poi', 'restaurant'].map(f => (
                        <button key={f} onClick={() => setSearchFilter(f as any)} className={\`flex-1 py-1.5 px-2 rounded-lg text-[10px] uppercase font-bold transition-colors \${searchFilter === f ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'}\`}>{f}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              
              {/* Skeleton Timeline Content */}
              <div className="p-4 pt-2">
                <div className="relative">
                  
                  {/* Wavy path line - looks like a winding road */}
                  <svg 
                    className="absolute left-[1.15rem] top-10 w-3" 
                    style={{ height: 'calc(100% - 5rem)' }}
                    viewBox="0 0 12 200" 
                    preserveAspectRatio="none"
                  >
                    <path 
                      d="M 6 0 
                         Q 12 25, 6 50 
                         Q 0 75, 6 100 
                         Q 12 125, 6 150
                         Q 0 175, 6 200"
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="2"
                      strokeDasharray="6 4"
                      strokeLinecap="round"
                      className="text-slate-500/60"
                    />
                  </svg>
                
                {/* START Point */}
                <div className="relative z-10 flex items-center p-2 -ml-2">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 bg-orange-500 border-slate-900 text-white shadow-lg">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div className="ml-4 flex-1">
                    <h3 className="text-lg font-bold text-slate-100">{originName}</h3>
                    <p className="text-xs text-slate-400 uppercase tracking-wider">START</p>
                  </div>
                </div>
                
                {/* Loading Indicator / Retry Button - in the middle */}
                <div className="relative z-10 py-16 pl-12">
                  <div className="flex flex-col items-center justify-center">
                    {hasError ? (
                      <>
                        <div className="text-red-400 text-sm mb-2 text-center">
                          {routeMeta?.details_error || 'Error generating route'}
                        </div>
                        <button 
                          onClick={handleRetry}
                          className="px-6 py-3 bg-red-900/50 hover:bg-red-900 border border-red-700 rounded-lg text-red-200 text-sm font-medium transition-all hover:scale-105"
                        >
                          Retry
                        </button>
                      </>
                    ) : showRetry ? (
                      <>
                        <div className="text-slate-400 text-sm mb-3">Timeout reached</div>
                        <button 
                          onClick={handleRetry}
                          className="px-6 py-3 bg-[#242830]/80 hover:bg-slate-700 border border-white/5 rounded-lg text-slate-300 text-sm font-medium transition-all hover:scale-105 flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Retry
                        </button>
                      </>
                    ) : (
                      <>
                        {/* Animated Loading Indicator */}
                        <div className="flex items-center gap-3 mb-3">
                          <div className="flex gap-1.5">
                            <div className="w-2.5 h-2.5 bg-orange-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <div className="w-2.5 h-2.5 bg-orange-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="w-2.5 h-2.5 bg-orange-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                        </div>
                        <div className="text-slate-400 text-sm">Building route...</div>
                      </>
                    )}
                  </div>
                </div>
                
                {/* END Point */}
                <div className="relative z-10 flex items-center p-2 -ml-2">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 bg-slate-100 border-slate-900 text-slate-900 shadow-lg">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                    </svg>
                  </div>
                  <div className="ml-4 flex-1">
                    <h3 className="text-lg font-bold text-slate-100">{destinationName}</h3>
                    <p className="text-xs text-slate-400 uppercase tracking-wider">END</p>
                  </div>
                </div>
                
                </div>
              </div>
            </div>
          </div>
          
          {/* Bottom Stats Bar - Loading state placeholders */}
          <div style={{ backdropFilter: 'blur(3px)' }} className="pointer-events-auto bg-[#0B0C10]/80 border-t border-white/5 px-4 py-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1 text-slate-500">
                <span className="font-mono text-slate-400">--</span>
                <span>km</span>
              </div>
              <div className="flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setShowDebugPanel(s => !s)}>
                <span className="text-sm">👾</span>
                <span className="text-[10px] text-slate-500 font-bold">STATUS:</span>
                <span className="font-mono text-orange-400 ml-1">{routeMeta?.details_status || 'init'}</span>
              </div>
            </div>
          </div>
        </div>



      </div>
    );
  }
`;

// App Main Layout Templates
export const layoutTemplates = {
  // Start of the main return block
  layoutStart: `
  return (
    <div className="h-screen w-screen overflow-hidden relative bg-[#0B0C10] text-slate-200">
      {/* FULLSCREEN MAP - Base Layer */}
      <div className="absolute inset-0 z-0">
        <ErrorBoundary fallback={<div className="w-full h-full flex items-center justify-center text-slate-500">Map Error</div>}>
          <MapComponent 
            routeDetails={routeDetails} 
            focusedSegmentId={focusedSegmentId}
            focusedPointId={focusedPointId}
            onSegmentClick={(segmentId: string) => setExpandedId(segmentId)}
            onPointClick={(pointId: string) => setExpandedId(pointId)}
          />
        </ErrorBoundary>
      </div>

      {/* TIMELINE OVERLAY - Left Panel with Glassmorphism */}
      <div className="absolute left-0 top-0 bottom-0 z-20 w-[380px] flex flex-col pointer-events-none">
        {/* Gradient fade on the right edge */}
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-r from-transparent to-[#0B0C10]/0 z-10 pointer-events-none" />
        
        {/* Timeline Content */}
        <div style={{ backdropFilter: 'blur(3px)' }} className="flex-1 overflow-y-auto overflow-x-hidden pointer-events-auto bg-[#0B0C10]/20 border-r border-white/5">
          <div className="relative">
            {/* Search Header - Sticky */}
            <div style={{ backdropFilter: 'blur(3px)' }} className="sticky top-0 z-40 p-4 pb-2 bg-[#0B0C10]/30 border-b border-white/5">
              <div className={\`transition-all duration-300 \${isSearchExpanded ? 'bg-[#15171C]/30 border border-white/5 shadow-xl rounded-2xl p-3' : 'bg-transparent'}\`}>
                <div className="relative flex items-center">
                  <div className="relative w-full flex items-center bg-[#242830]/40 border border-white/5 rounded-full overflow-hidden shadow-lg backdrop-blur-sm">
                    <input 
                      type="text"
                      placeholder="Search route..."
                      value={searchQuery}
                      onFocus={() => setIsSearchExpanded(true)}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-transparent text-slate-200 placeholder-slate-400 px-4 py-2.5 pr-10 outline-none text-sm"
                    />
                    <button className="absolute right-1 top-1 bottom-1 aspect-square bg-orange-600/90 rounded-full flex items-center justify-center text-white hover:bg-orange-500 transition-colors"><Search size={14} /></button>
                  </div>
                  {isSearchExpanded && (
                    <button onClick={() => setIsSearchExpanded(false)} className="ml-2 text-slate-400 hover:text-white transition-colors"><X size={18} /></button>
                  )}
                </div>
                {isSearchExpanded && (
                  <div className="mt-2 flex gap-1 bg-[#15171C]/50 p-1 rounded-xl border border-white/10/30">
                    {['city', 'poi', 'restaurant'].map(f => (
                      <button key={f} onClick={() => setSearchFilter(f as any)} className={\`flex-1 py-1.5 px-2 rounded-lg text-[10px] uppercase font-bold transition-colors \${searchFilter === f ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'}\`}>{f}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
            {/* Timeline Points */}
            <div className="p-4 pt-2">
`,

  // Bottom Stats Bar and footer
  separator: `
  </div>
  </div>
  </div>

{/* Bottom Stats Bar */}
<div style={{ backdropFilter: 'blur(3px)' }} className="pointer-events-auto bg-[#0B0C10]/80 backdrop-blur-xl border-t border-white/5 px-4 py-3">
  <div className="flex items-center justify-between gap-2 text-xs">
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-1 text-slate-400">
        <span className="font-mono text-slate-200">{routeDetails?.summary?.distance_km?.toFixed(0) || '--'}</span>
        <span>km</span>
      </div>
      <div className="h-3 w-px bg-slate-700" />
      <div className="flex items-center gap-1 text-slate-400">
        <span>Сложность: </span>
        <span className="font-mono text-orange-400">{routeDetails?.summary?.serpentine_score?.toFixed(1) || '--'}</span>
      </div>
      <div className="h-3 w-px bg-slate-700" />
      <div className="flex items-center gap-1 text-slate-400">
        <span>Красота: </span>
        <span className="font-mono text-emerald-400">{routeDetails?.summary?.beauty_score?.toFixed(1) || '--'}</span>
      </div>
    </div>
  </div>
</div>
</div> {/* Close OVERLAY panel */}
`,
};
