'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import ImageUpload from '@/components/ImageUpload';

interface UploadResult {
  storedPath: string;
  previewUrl: string;
  filename: string;
}

export default function NewVideoProjectPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [baseImage, setBaseImage] = useState<UploadResult | null>(null);
  const [originalScript, setOriginalScript] = useState('');
  const [skillVersion, setSkillVersion] = useState('v2');
  const [creatorDescription, setCreatorDescription] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!baseImage) {
      setError('Please upload a character reference image.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/v1/video-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          baseImagePath: baseImage.storedPath,
          originalScript,
          skillVersion,
          ...(creatorDescription.trim() ? { creatorDescription: creatorDescription.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Failed to create project');
        return;
      }
      const data = await res.json();
      router.push(`/video-projects/${data.id}`);
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-breadcrumb">
            <Link href="/video-projects" style={{ color: 'var(--text-muted)' }}>Video Projects</Link>
            <span>›</span>
            <span style={{ color: 'var(--text-primary)' }}>New Project</span>
          </div>
        </div>
      </div>

      <div className="page-body" style={{ maxWidth: 720 }}>
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 4 }}>New Video Project</h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            Paste your UGC ad script and Claude will break it into scenes using the skill.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="form-group">
                <label className="form-label">Project name</label>
                <input
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. Menswear UGC - Week 12"
                />
              </div>

              <ImageUpload
                label="Character reference image"
                hint="This image is used as the visual reference for every generated screen to keep the character consistent."
                value={baseImage}
                onChange={setBaseImage}
              />

              <div className="form-group">
                <label className="form-label">Creator description <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
                <textarea
                  className="form-textarea"
                  value={creatorDescription}
                  onChange={(e) => setCreatorDescription(e.target.value)}
                  rows={3}
                  placeholder="Describe the character - personality, voice, accent, energy, appearance..."
                />
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  This seeds the creative brief. Claude will extract more detail from the approved Screen 1 prompt.
                </p>
              </div>

              <div className="form-group">
                <label className="form-label">UGC skill version</label>
                <select
                  className="form-select"
                  value={skillVersion}
                  onChange={(e) => setSkillVersion(e.target.value)}
                  style={{ maxWidth: 160 }}
                >
                  <option value="v2">v2 (recommended)</option>
                  <option value="v1">v1 (legacy)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Script</div>
                <div className="card-subtitle">Paste the full UGC ad script. Claude will split it into screens.</div>
              </div>
            </div>
            <div className="card-body">
              <textarea
                className="form-textarea"
                value={originalScript}
                onChange={(e) => setOriginalScript(e.target.value)}
                required
                rows={14}
                placeholder={`[Hook]\nThe easiest way to upgrade a man's look...\n\n[Body]\nStart with the pants. The right colour...`}
              />
            </div>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Link href="/video-projects">
              <button type="button" className="btn btn-secondary">Cancel</button>
            </Link>
            <button type="submit" className="btn btn-primary" disabled={saving || !baseImage}>
              {saving ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
