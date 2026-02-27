import { Project, SyntaxKind, QuoteKind, Node } from 'ts-morph';
import path from 'node:path';
import fs from 'node:fs';
import { logStep, ensureDirectory, copyDir, fileExists, readFile } from '../lib/mapper-utils';


const SOURCE_DIR = 'dist/aistudio/wizard';
const STYLE_DIR = 'dist/aistudio/style';
const OUTPUT_DIR = 'src/mount/wizard';


async function main() {
  logStep('Mapper via AST: Initializing...');

  try {
    ensureDirectory(OUTPUT_DIR);
    copyDir(`${STYLE_DIR}/components`, `${OUTPUT_DIR}/components`);
    copyDir(`${STYLE_DIR}/services`, `${OUTPUT_DIR}/services`);

    const deadComponents = ['LoginModal.tsx', 'RegisterModal.tsx'];

    deadComponents.forEach(file => {
      const p = `${OUTPUT_DIR}/components/${file}`;
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch { /* ignore */ }
      }
    });

    const geminiServicePath = `${OUTPUT_DIR}/services/geminiService.ts`;
    if (fs.existsSync(path.resolve(geminiServicePath))) {
      fs.unlinkSync(path.resolve(geminiServicePath));
    }
  } catch (err) {
    console.error('CRASH in directory/file prep:', err);
    throw err;
  }

  const project = new Project({
    manipulationSettings: { quoteKind: QuoteKind.Single },
    skipAddingFilesFromTsConfig: true,
  });

  // TYPES.TS
  try {
    const typesPath = `${SOURCE_DIR}/types.ts`;
    if (fs.existsSync(path.resolve(typesPath))) {
      const typesSource = readFile(path.relative(process.cwd(), typesPath));
      const typesFile = project.createSourceFile(`${OUTPUT_DIR}/types.ts`, typesSource, { overwrite: true });

      const tripConfig = typesFile.getInterface('TripConfig');
      if (tripConfig) {
        tripConfig.addProperties([
          { name: 'originCoords', type: '{ lat: number; lng: number } | null', hasQuestionToken: true },
          { name: 'destinationCoords', type: '{ lat: number; lng: number } | null', hasQuestionToken: true }
        ]);
      }
      typesFile.getVariableStatement('PRESET_DESTINATIONS')?.remove();
      const rr = typesFile.getInterface('RouteResponse') || typesFile.getTypeAlias('RouteResponse');
      if (rr) rr.remove();
      typesFile.saveSync();
    }
  } catch (err) { console.error(err); }

  // CHIP.TSX
  try {
    const chipPath = `${OUTPUT_DIR}/components/Chip.tsx`;
    if (fileExists(path.relative(process.cwd(), chipPath))) {
      const chipFile = project.addSourceFileAtPath(chipPath);
      const chipProps = chipFile.getInterface('ChipProps');
      if (chipProps) {
        chipProps.getProperty('coordinates')?.remove();
        chipProps.addProperty({ name: 'coordinates', type: '{ lat: number; lng: number }', hasQuestionToken: true });
      }
      chipFile.saveSync();
    }
  } catch (err) { console.error(err); }

  // APP.TSX
  try {
    logStep('Transforming App.tsx via AST');
    const appPath = `${SOURCE_DIR}/App.tsx`;
    if (!fs.existsSync(path.resolve(appPath))) return;

    const appSource = readFile(path.relative(process.cwd(), appPath));
    const appFile = project.createSourceFile(`${OUTPUT_DIR}/App.tsx`, appSource, { overwrite: true });

    // 1. Imports
    const importsToRemove: Node[] = [];
    appFile.getImportDeclarations().forEach(decl => {
      const ms = decl.getModuleSpecifierValue();
      if (ms.includes('geminiService') || ms.endsWith('.css') || ms === 'leaflet' || ms.includes('LoginModal') || ms.includes('RegisterModal')) {
        importsToRemove.push(decl);
      }
      if (decl.getNamedImports().some(ni => ni.getName() === 'PRESET_DESTINATIONS')) {
        decl.getNamedImports().find(ni => ni.getName() === 'PRESET_DESTINATIONS')?.remove();
        if (decl.getNamedImports().length === 0) importsToRemove.push(decl);
      }
      if (ms === './types') {
        ['RouteResponse', 'ExperienceLevel', 'NightRidePreference'].forEach(typeName => {
          decl.getNamedImports().find(ni => ni.getName() === typeName)?.remove();
        });
        if (decl.getNamedImports().length === 0) importsToRemove.push(decl);
      }
      // Remove unused useState/useEffect/useRef from local react import if present
      if (ms === 'react' || ms === 'React') {
        ['useState', 'useEffect', 'useRef'].forEach(hook => {
          const named = decl.getNamedImports().find(ni => ni.getName() === hook);
          if (named) named.remove();
        });
        if (decl.getNamedImports().length === 0 && !decl.getDefaultImport() && !decl.getNamespaceImport()) {
          importsToRemove.push(decl);
        }
      }
    });
    importsToRemove.forEach(d => { try { d.remove(); } catch { /* ignore */ } });

    // Clean up lucide-react imports that are not exported or unused
    const lucideDecl = appFile.getImportDeclaration(d => d.getModuleSpecifierValue() === 'lucide-react');
    if (lucideDecl) {
      ['CheckCircle2', 'User', 'ChevronDown', 'ImageIcon', 'Image', 'X'].forEach(name => {
        lucideDecl.getNamedImports().find(ni => ni.getName() === name)?.remove();
      });
    }

    appFile.addImportDeclarations([
      { moduleSpecifier: 'mapbox-gl/dist/mapbox-gl.css' },
      { namedImports: ['useGeolocation'], moduleSpecifier: '@/hooks/useGeolocation' },
      // { namedImports: ['useSearchParams'], moduleSpecifier: 'react-router-dom' },
      { namedImports: ['createRoute'], moduleSpecifier: '@/services/routeService' },
      { namedImports: ['searchLocations', 'reverseGeocode'], moduleSpecifier: '@/services/mapboxService' },
      { namedImports: ['signIn', 'signOut', 'getCurrentUser', 'onAuthStateChange'], moduleSpecifier: '@/services/authService' },
      { namedImports: ['PRESET_DESTINATIONS'], moduleSpecifier: '@/config/locations' },
      { namedImports: ['EL_ANGEL_COORDS'], moduleSpecifier: '@/config/constants' },
      { defaultImport: 'mapboxgl', moduleSpecifier: 'mapbox-gl' } as any
    ]);
    // appFile.getImportDeclaration(d => d.getModuleSpecifierValue() === 'lucide-react')?.addNamedImport('X');

    // 2. LocationPicker Replacement
    const locInputProps = appFile.getInterface('LocationInputProps');
    locInputProps?.addProperty({ name: 'onCoordinatesChange', type: '(coords: { lat: number; lng: number }) => void', hasQuestionToken: true });

    const locPickerVar = appFile.getVariableDeclaration('LocationPicker');
    if (locPickerVar) {
      // STRICT MAPBOX IMPLEMENTATION
      const newCode = `({ label, placeholder, value, onChange, icon: Icon, extraAction, onCoordinatesChange }) => {
  const [showMap, setShowMap] = React.useState(false);
  const [loadingMap, setLoadingMap] = React.useState(false);
  const mapContainerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<mapboxgl.Map | null>(null);
  const markerRef = React.useRef<mapboxgl.Marker | null>(null);
  const debounceRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    if (showMap && mapContainerRef.current && !mapRef.current) {
        const map = new mapboxgl.Map({
            container: mapContainerRef.current,
            style: 'mapbox://styles/mapbox/dark-v11',
            center: [-103, 23],
            zoom: 5.8,
            attributionControl: false
        });

      map.on('click', async (e) => {
        const { lat, lng } = e.lngLat;
        if (markerRef.current) markerRef.current.remove();
        markerRef.current = new mapboxgl.Marker({ color: '#E87703' })
            .setLngLat([lng, lat])
            .addTo(map);

        onCoordinatesChange?.({ lat, lng });
        setLoadingMap(true);
        try {
          const res = await reverseGeocode(lat, lng);
          if (res && res.fullAddress) onChange(res.fullAddress);
        } catch (err) { console.error(err); } 
        finally { setLoadingMap(false); }
      });
      mapRef.current = map;
    }
    return () => {
      if (!showMap && mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMap]);

  React.useEffect(() => {
    if (!showMap || !value) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      if (!mapRef.current || value.length < 3) return;
      try {
        const results = await searchLocations(value);
        if (results && results.length > 0) {
          const { lat, lng } = results[0].coordinates;
          mapRef.current.flyTo({ center: [lng, lat], zoom: 13 });
          if (markerRef.current) markerRef.current.remove();
          markerRef.current = new mapboxgl.Marker({ color: '#E87703' }).setLngLat([lng, lat]).addTo(mapRef.current);
          onCoordinatesChange?.({ lat, lng });
        }
      } catch (_err) { /* ignore */ }
    }, 1000);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, showMap, onCoordinatesChange]);

  return (
    <div className="mb-6">
      <label className={SECTION_LABEL_CLASS}>{label}</label>
      <div className="relative group bg-[#111827] rounded-2xl transition-all duration-300 focus-within:ring-1 focus-within:ring-moto-brand/40 shadow-sm h-[52px] flex items-center border border-white/5">
        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-gray-400">
          <Icon size={18} className="group-focus-within:text-moto-brand/80 transition-colors" />
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-full bg-transparent text-white rounded-2xl pl-12 pr-20 focus:outline-none font-sans placeholder:text-[#6B7280] text-[14px] font-medium"
        />
        <div className="absolute inset-y-0 right-3 flex items-center gap-2">
          {extraAction}
          <button 
             onClick={() => setShowMap(!showMap)}
             className={\`p-1.5 rounded-lg transition-all \${showMap ? 'text-moto-brand bg-moto-brand/10' : 'text-gray-400 hover:text-white'}\`}
          >
             <MapIcon size={18} />
          </button>
        </div>
      </div>
      {showMap && (
        <div className="mt-4 animate-in slide-in-from-top-2 fade-in duration-300">
           <div className="relative h-48 w-full rounded-2xl overflow-hidden border border-white/10">
               <div ref={mapContainerRef} className="h-full w-full bg-slate-900" />
               {loadingMap && (
                 <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[1000]">
                    <Loader2 className="animate-spin text-moto-brand" />
                 </div>
               )}
           </div>
        </div>
      )}
    </div>
  );
}`;
      locPickerVar.setInitializer(newCode);
    }

    // 3. App rename and props
    const appFunc = appFile.getFunction('App') || appFile.getVariableStatement('App')?.getDeclarations()[0]?.getInitializerIfKind(SyntaxKind.ArrowFunction);
    if (!appFunc) return; // Should not happen

    if (Node.isFunctionDeclaration(appFunc)) {
      appFunc.getNameNode()?.replaceWithText('WizardApp');
    } else {
      appFile.getVariableStatement('App')!.getDeclarations()[0].getNameNode().replaceWithText('WizardApp');
    }

    appFile.getExportAssignments().forEach(exp => {
      if (exp.getExpression().getText() === 'App') exp.getExpression().replaceWithText('WizardApp');
    });

    appFile.addInterface({
      name: 'WizardAppProps',
      properties: [
        { name: 'onComplete', type: '(routeId: string) => void', hasQuestionToken: true },
        { name: 'onError', type: '(error: Error) => void', hasQuestionToken: true },
      ]
    });

    // 4. Inject Logic (Auth, Geolocation, Route)
    if (Node.isFunctionDeclaration(appFunc) || Node.isArrowFunction(appFunc)) {
      appFunc.addParameter({ name: '{ onComplete, onError }', type: 'WizardAppProps' });
      const body = appFunc.getBody();
      if (Node.isBlock(body)) {
        // Inject state/hooks at top of body
        body.insertStatements(0, [
          "const { location, loading: geoLoading } = useGeolocation();",
          "const [authUser, setAuthUser] = React.useState<{ id: string; email?: string } | null>(null);",
          "const [authEmail, setAuthEmail] = React.useState('');",
          "const [authLoading, setAuthLoading] = React.useState(false);",
          "const [authError, setAuthError] = React.useState('');",
          "const [authSuccess, setAuthSuccess] = React.useState(false);",
          "const [savedWorkspaces] = React.useState<Array<{ id: string; name?: string }>>([]);",
          // ... (Complete hook logic same as before) ...
          `React.useEffect(() => {
                         if (geoLoading || !location || !location.latitude || !location.longitude) return;
                         setTrip(prev => {
                           if (prev.originCoords || prev.origin) return prev;
                           const originLabel = [location.city, location.country].filter(Boolean).join(', ');
                           const fallbackLabel = 'Ángel de la Independencia, México';
                             const safeLat = Number.isFinite(location.latitude) ? location.latitude : EL_ANGEL_COORDS.lat;
                             const safeLng = Number.isFinite(location.longitude) ? location.longitude : EL_ANGEL_COORDS.lng;
                           return {
                             ...prev,
                             origin: originLabel || prev.origin || fallbackLabel,
                             originCoords: { lat: safeLat, lng: safeLng },
                           };
                         });
                       }, [geoLoading, location]);`,
          `React.useEffect(() => {
                         getCurrentUser().then(setAuthUser).catch(() => {});
                         const unsub = onAuthStateChange(setAuthUser);
                         return unsub;
                       }, []);`,
          `const handleSignIn = async () => {
                         if (!authEmail) return;
                         setAuthLoading(true);
                         setAuthError('');
                         setAuthSuccess(false);
                         try {
                           await signIn(authEmail, window.location.origin + window.location.pathname);
                           setAuthSuccess(true);
                         } catch (err) {
                           setAuthError(err instanceof Error ? err.message : 'Error al iniciar sesión');
                         } finally {
                           setAuthLoading(false);
                         }
                       };`,
          `const handleSignOut = async () => {
                         try {
                           await signOut();
                           setAuthUser(null);
                           setIsLoginOpen(false);
                         } catch (err) {
                           setAuthError(err instanceof Error ? err.message : 'Error al cerrar sesión');
                         }
                       };`
        ]);

        // Rename vars and fix implicit any in state updates
        body.forEachDescendant(node => {
          if (Node.isBindingElement(node) || Node.isVariableDeclaration(node)) {
            const name = node.getName();
            if (name === 'isLoading') node.rename('isGenerating');
            if (name === 'setIsLoading') node.rename('setIsGenerating');
            if (name === 'error') node.rename('generationError');
            if (name === 'setError') node.rename('setGenerationError');
            if (name === 'isRegisterOpen') node.rename('_isRegisterOpen');
            if (name === 'resetFlow') node.rename('_resetFlow');
          }
          // Fix hooks to use React namespace
          if (Node.isCallExpression(node)) {
            const exp = node.getExpression().getText();
            if (['useState', 'useEffect', 'useRef', 'useMemo'].includes(exp)) {
              node.getExpression().replaceWithText(`React.${exp}`);
            }
          }
        });

        // Use string replacement for the most complex parts to avoid AST crashes
        let bodyText = body.getText();
        bodyText = bodyText.replace(/setTrip\(prev =>/g, 'setTrip((prev: TripConfig) =>');
        bodyText = bodyText.replace(/setStep\(prev =>/g, 'setStep((prev: 1|2|3) =>');
        bodyText = bodyText.replace(/catch\s*\(e\)/g, 'catch (_e)');
        body.replaceWithText(bodyText);

        // Remove old result state/logic
        body.getStatements().find(s => s.getText().includes('setResult]'))?.remove();
        // Remove definition and any usage of setResult
        body.forEachDescendant(node => {
          if (Node.isCallExpression(node) && node.getExpression().getText() === 'setResult') {
            node.getParentIfKind(SyntaxKind.ExpressionStatement)?.remove();
          }
        });

        body.getVariableStatement('handleGenerate')?.remove();

        // Add handleGenerateRoute
        const handleGenerateRouteCode = `
      const handleGenerateRoute = async () => {
        setGenerationError('');
        const normalizeCoords = (coords?: { lat: number; lng: number } | null) => ({
          lat: Number.isFinite(coords?.lat) ? coords!.lat : EL_ANGEL_COORDS.lat,
          lng: Number.isFinite(coords?.lng) ? coords!.lng : EL_ANGEL_COORDS.lng,
        });
        const createLocation = (label: string, coords?: { lat: number; lng: number } | null) => {
          const normalized = normalizeCoords(coords);
          return { label: label || 'No indicado', lat: normalized.lat, lng: normalized.lng };
        };
        let originCoords = trip.originCoords ? normalizeCoords(trip.originCoords) : null;
        const destinationCoords = trip.destinationCoords ? normalizeCoords(trip.destinationCoords) : null;
        if (!originCoords) originCoords = EL_ANGEL_COORDS;
        const requestBody = {
          origin: createLocation(typeof trip.origin === 'string' ? trip.origin : '', originCoords),
          destination: createLocation(typeof trip.destination === 'string' ? trip.destination : '', destinationCoords),
          departure_date: trip.startDate?.toISOString() || new Date().toISOString(),
          outbound_style: 'scenic' as const,
          return_mode: 'none' as const,
          locale: 'es',
          include_tolls_metric: true,
          rider_experience: trip.experience,
          night_ride_preference: trip.nightRide === 'batman' ? 'ok' : trip.nightRide,
        };
        setIsGenerating(true);
        try {
          const { data, error } = await createRoute(requestBody);
          if (error || !data?.routeId) throw error || new Error('No se generó ruta');
          onComplete?.(data.routeId);
        } catch (err) {
          setGenerationError(err instanceof Error ? err.message : 'Error desconocido');
          onError?.(err instanceof Error ? err : new Error('Error desconocido'));
        } finally {
          setIsGenerating(false);
        }
      };`;
        body.insertStatements(body.getStatements().length - 1, handleGenerateRouteCode);

        // Update handleGeolocation
        const handleGeo = body.getVariableStatement('handleGeolocation');
        handleGeo?.forEachDescendant(n => {
          if (Node.isCallExpression(n) && n.getExpression().getText().includes('getCurrentPosition')) {
            n.getArguments()[0]?.replaceWithText(`(pos: GeolocationPosition) => {
                        const { latitude, longitude } = pos.coords;
                        setTrip((prev: TripConfig) => ({ ...prev, origin: 'Ubicación actual (Detectada)', originCoords: { lat: latitude, lng: longitude } }));
                    }`);
          }
        });
      }
    }

    // 5. JSX Transformations (Structural & Text)

    // 5.1 Update Chips
    appFile.forEachDescendant(node => {
      if (Node.isCallExpression(node) && node.getExpression().getText().includes('PRESET_DESTINATIONS.map')) {
        const jsx = node.getArguments()[0]?.asKind(SyntaxKind.ArrowFunction)?.getBody()?.asKind(SyntaxKind.ParenthesizedExpression)?.getExpression();
        if (Node.isJsxSelfClosingElement(jsx)) {
          jsx.addAttribute({ name: 'coordinates', initializer: '{dest.coordinates}' });
          jsx.getAttribute('onClick')?.setInitializer('{() => setTrip({...trip, destination: dest.name, destinationCoords: dest.coordinates})}');
          jsx.getAttribute('key')?.setInitializer('{dest.name}');
          jsx.getAttribute('label')?.setInitializer('{dest.name}');
          jsx.getAttribute('selected')?.setInitializer('{trip.destination === dest.name}');
        }
      }
    });

    // 5.2 Header Text (Safe to use text replacement)
    let fullText = appFile.getFullText();
    const headerPattern = /Hola,\s*<span[^>]*>Max<\/span>\.\s*¿Listo para rodar\?/g;
    const headerReplacement = `{authUser ? (
                    <>Hola, <span className="text-moto-brand font-bold">{authUser.email?.split('@')[0]}</span>. ¿Listo para rodar?</>
                  ) : (
                    <button onClick={() => setIsLoginOpen(true)} className="text-orange-500 hover:underline hover:text-orange-400 transition-colors">Inicia sesión</button>
                  )}`;
    if (headerPattern.test(fullText)) {
      appFile.replaceWithText(fullText.replace(headerPattern, headerReplacement));
      logStep('Replaced Header Text');
    }

    // 5.3 Saved Tab & Result Removal (Structural AST)
    // Find the ternary: activeTab === 'saved' ? ... : ...
    const activeTabTernary = appFile.getDescendants().find(n =>
      Node.isConditionalExpression(n) && n.getCondition().getText().includes("activeTab === 'saved'")
    );

    if (Node.isConditionalExpression(activeTabTernary)) {
      logStep('Found activeTab ternary');

      // 5.3.1 Replace 'whenTrue' (Saved Tab)
      const savedReplacement = `{authUser ? (
                  savedWorkspaces.length > 0 ? (
                    <ul className="space-y-2">
                      {savedWorkspaces.map((ws) => (
                        <li key={ws.id}>
                          <button onClick={() => { window.location.href = '/route/' + ws.id; }} className="w-full text-left p-3 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 text-slate-200 transition-colors">
                            {ws.name || 'Ruta ' + ws.id.slice(0, 6)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-moto-muted p-12 text-center">
                       <History size={64} className="opacity-10 mb-6" />
                       <p className="font-sans font-bold text-xs uppercase tracking-[0.2em]">Sin historial</p>
                    </div>
                  )
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-moto-muted p-12 text-center">
                    <p className="font-sans font-bold text-xs uppercase tracking-[0.2em] mb-4">Inicia sesión para ver historial</p>
                    <button onClick={() => setIsLoginOpen(true)} className="text-orange-400 hover:text-orange-300 font-bold hover:underline">Inicia sesión</button>
                  </div>
                )}`;

      // We need to wrap it in the container div from the source
      // The source has <div className="..."> ... </div>
      // We can just construct the whole True branch string
      const trueBranchText = `(
              <div className="h-full flex flex-col items-center justify-center text-moto-muted p-12 text-center animate-in fade-in duration-500">
                 <History size={64} className="opacity-10 mb-6" />
                 <p className="font-sans font-bold text-xs uppercase tracking-[0.2em]">
                    ${savedReplacement}
                 </p>
                 <button onClick={() => setActiveTab('new')} className="mt-8 text-moto-brand font-bold uppercase tracking-[0.2em] text-[10px] hover:underline">Planear viaje</button>
              </div>
        )`;

      activeTabTernary.getWhenTrue().replaceWithText(trueBranchText);
      logStep('Replaced Saved Tab Content');

      // 5.3.2 Remove Result View (whenFalse)
      // Check if whenFalse is another ternary (result ? ... : ...)
      const nested = activeTabTernary.getWhenFalse();
      if (Node.isConditionalExpression(nested)) {
        // Check if condition is 'result' or 'result != null'
        if (nested.getCondition().getText().includes('result')) {
          // We want to KEEP the False branch of this nested ternary (The Stepper)
          // and replace the WHOLE nested ternary with it.
          const stepper = nested.getWhenFalse().getText();
          nested.replaceWithText(stepper);
          logStep('Removed Result View (Unwrapped ternary)');
        }
      }
    } else {
      console.warn('Could not find activeTab ternary! UI replacement failed.');
    }

    // 6. Update LocationPicker attributes
    appFile.forEachDescendant(node => {
      if (Node.isJsxSelfClosingElement(node) && node.getTagNameNode().getText() === 'LocationPicker') {
        const label = node.getAttribute('label')?.asKind(SyntaxKind.JsxAttribute)?.getInitializer()?.getText();
        if (label?.includes('ORIGEN')) node.addAttribute({ name: 'onCoordinatesChange', initializer: '{(coords) => setTrip((prev: TripConfig) => ({ ...prev, originCoords: coords }))}' });
        if (label?.includes('DESTINO')) node.addAttribute({ name: 'onCoordinatesChange', initializer: '{(coords) => setTrip((prev: TripConfig) => ({ ...prev, destinationCoords: coords }))}' });
      }
      if (Node.isIdentifier(node) && node.getText() === 'handleGenerate') {
        // Only replace if it's a call expression or reference, not the declaration (which we removed)
        if (!Node.isVariableDeclaration(node.getParent()))
          node.replaceWithText('handleGenerateRoute');
      }
    });

    // 7. Inject Auth Modal (Text replacement still safest for appending to end)
    fullText = appFile.getFullText();
    const registerModalPattern = /<Modal isOpen={_?isRegisterOpen}.*<\/Modal>/s;
    const unifiedModalJsx = `<Modal isOpen={isLoginOpen} onClose={() => { setIsLoginOpen(false); setAuthError(''); setAuthSuccess(false); }} title="Inicia sesión">
            <div className="space-y-6">
              {authSuccess ? (
                <div className="text-center py-4">
                  <p className="text-green-400 font-bold text-lg">Revisa tu correo</p>
                  <p className="text-slate-400 text-sm mt-2">Enviamos un enlace mágico a {authEmail}</p>
                </div>
              ) : authUser ? (
                <div className="space-y-4">
                  <p className="text-slate-300 text-sm">Sesión iniciada como {authUser.email || authUser.id}</p>
                  <button onClick={handleSignOut} className={btnSecondaryClass + " w-full h-12 text-sm"}>
                    Cerrar sesión
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-russo text-slate-500 mb-2 uppercase tracking-widest">Correo</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                      <input
                        type="email"
                        placeholder="tu@email.com"
                        value={authEmail}
                        onChange={(e) => setAuthEmail(e.target.value)}
                        className="w-full bg-slate-800/50 border border-slate-700 rounded-xl py-3 pl-12 pr-4 text-slate-200 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/50 transition-all"
                      />
                    </div>
                  </div>
                  {authError && <p className="text-red-400 text-sm">{authError}</p>}
                  <button
                    onClick={handleSignIn}
                    disabled={authLoading || !authEmail}
                    className={btnPrimaryClass + " w-full h-14 text-sm"}
                  >
                    {authLoading ? 'Enviando...' : 'Enviar enlace mágico'}
                  </button>
                </>
              )}
            </div>
          </Modal>`;
    if (registerModalPattern.test(fullText)) {
      appFile.replaceWithText(fullText.replace(registerModalPattern, unifiedModalJsx));
      logStep('Replaced Auth Modal');
    }

    // Final robustness pass: Remove 'result' ternary if it still exists
    appFile.forEachDescendant(node => {
      if (Node.isConditionalExpression(node)) {
        const cond = node.getCondition().getText();
        if (cond === 'result' || cond.includes('result ?')) {
          node.replaceWithText(node.getWhenFalse().getText());
          logStep('Forced removal of result view ternary');
        }
      }
    });

    appFile.saveSync();
    logStep('Mapper via AST: Complete');

  } catch (err) {
    console.error('CRASH in App.tsx transformation:', err);
  }
}

main();
