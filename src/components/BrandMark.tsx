import { brandMarkPaths, brandMarkStroke, brandMarkViewBox } from '../../shared/brand-mark.mjs'

export function BrandMark({ size = 30, className }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox={brandMarkViewBox} className={className} fill="none" stroke="currentColor" strokeWidth={brandMarkStroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {brandMarkPaths.map(path => <path key={path} d={path} />)}
  </svg>
}
