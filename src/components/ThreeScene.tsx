import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

type Metric = 'growth' | 'reach' | 'intensity';

const metricLabels: Record<Metric, string> = {
  growth: 'Growth index',
  reach: 'Audience reach',
  intensity: 'Signal intensity',
};

const locations = [
  { name: 'Delhi', lat: 28.6, lon: 77.2, growth: 0.86, reach: 0.72, intensity: 0.92 },
  { name: 'London', lat: 51.5, lon: -0.1, growth: 0.62, reach: 0.89, intensity: 0.68 },
  { name: 'New York', lat: 40.7, lon: -74, growth: 0.78, reach: 0.96, intensity: 0.81 },
  { name: 'Singapore', lat: 1.3, lon: 103.8, growth: 0.91, reach: 0.74, intensity: 0.77 },
  { name: 'São Paulo', lat: -23.5, lon: -46.6, growth: 0.69, reach: 0.66, intensity: 0.7 },
  { name: 'Tokyo', lat: 35.7, lon: 139.7, growth: 0.58, reach: 0.91, intensity: 0.83 },
  { name: 'Nairobi', lat: -1.3, lon: 36.8, growth: 0.82, reach: 0.52, intensity: 0.61 },
];

function pointOnGlobe(latitude: number, longitude: number, radius: number) {
  const phi = (90 - latitude) * (Math.PI / 180);
  const theta = (longitude + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

export function ThreeScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<() => void>(() => undefined);
  const runningRef = useRef(true);
  const [metric, setMetric] = useState<Metric>('growth');
  const [running, setRunning] = useState(true);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.1, 3.35);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const globeGroup = new THREE.Group();
    scene.add(globeGroup);
    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 28),
      new THREE.MeshBasicMaterial({ color: 0x8197ff, transparent: true, opacity: 0.22, wireframe: true }),
    );
    globeGroup.add(globe);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.045, 40, 28),
      new THREE.MeshBasicMaterial({ color: 0x4e6ee8, transparent: true, opacity: 0.06, side: THREE.BackSide }),
    );
    globeGroup.add(atmosphere);

    const bars = new THREE.Group();
    globeGroup.add(bars);
    const metricColor = metric === 'growth' ? 0x63d6b0 : metric === 'reach' ? 0x8a9cff : 0xffb45d;
    for (const location of locations) {
      const value = location[metric];
      const height = 0.08 + value * 0.34;
      const direction = pointOnGlobe(location.lat, location.lon, 1).normalize();
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.062, height, 8),
        new THREE.MeshBasicMaterial({ color: metricColor, transparent: true, opacity: 0.95 }),
      );
      bar.position.copy(direction.clone().multiplyScalar(1 + height / 2));
      bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      bars.add(bar);
    }

    const stars = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(Array.from({ length: 90 }, (_, index) => {
        const angle = index * 2.39996;
        const radius = 2.2 + (index % 11) * 0.08;
        return new THREE.Vector3(Math.cos(angle) * radius, ((index % 13) - 6) * 0.18, Math.sin(angle) * radius);
      })),
      new THREE.PointsMaterial({ color: 0xb8c5ff, size: 0.018, transparent: true, opacity: 0.48 }),
    );
    scene.add(stars);

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      container.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      globeGroup.rotation.y += (event.clientX - lastX) * 0.008;
      globeGroup.rotation.x = Math.max(-0.7, Math.min(0.7, globeGroup.rotation.x + (event.clientY - lastY) * 0.006));
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      container.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      camera.position.z = Math.max(2.55, Math.min(4.3, camera.position.z + event.deltaY * 0.002));
    };
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);
    container.addEventListener('wheel', onWheel, { passive: false });

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      if (runningRef.current && !dragging) {
        globeGroup.rotation.y += 0.0028;
        stars.rotation.y -= 0.0005;
      }
      renderer.render(scene, camera);
    };
    animate();
    resetRef.current = () => {
      globeGroup.rotation.set(0, 0, 0);
      camera.position.set(0, 0.1, 3.35);
    };

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
      container.removeEventListener('wheel', onWheel);
      renderer.dispose();
      globe.geometry.dispose();
      (globe.material as THREE.Material).dispose();
      atmosphere.geometry.dispose();
      (atmosphere.material as THREE.Material).dispose();
      bars.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      stars.geometry.dispose();
      (stars.material as THREE.Material).dispose();
      renderer.domElement.remove();
    };
  }, [metric]);

  return (
    <section className="three-scene-card" aria-label="Three.js interactive data globe">
      <div className="three-scene-heading">
        <div>
          <span className="eyebrow">THREE.JS 3D VIEW</span>
          <strong>Interactive data globe</strong>
          <small>Drag to orbit · scroll to zoom</small>
        </div>
        <select value={metric} onChange={(event) => setMetric(event.target.value as Metric)} aria-label="Globe metric">
          {(Object.keys(metricLabels) as Metric[]).map((key) => <option key={key} value={key}>{metricLabels[key]}</option>)}
        </select>
      </div>
      <div ref={containerRef} className="three-scene-viewport" role="img" aria-label={`${metricLabels[metric]} shown as bars around a rotating globe`} />
      <div className="three-scene-actions">
        <button className="outline-button" type="button" onClick={() => setRunning((value) => !value)}>{running ? 'Pause motion' : 'Play motion'}</button>
        <button className="small-button" type="button" onClick={() => resetRef.current()} aria-label="Reset globe view">Reset</button>
        <span>{locations.length} locations · {metricLabels[metric]}</span>
      </div>
    </section>
  );
}
