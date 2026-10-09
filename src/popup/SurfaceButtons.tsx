import type { ReactNode } from 'react';
import { CloseIcon, SidePanelIcon, WindowIcon } from './icons';
import { closeSurface, openDetachedWindow, openSidePanel, type Surface } from './surface';

interface SurfaceButton {
  label: string;
  icon: ReactNode;
  action: () => Promise<void>;
}

// Icon buttons to keep the app open: move it to the side panel or a window, or close the one it is in.
export default function SurfaceButtons({ surface, onError }: { surface: Surface; onError: (message: string) => void }) {
  const sidePanel: SurfaceButton = { label: 'Open in side panel', icon: <SidePanelIcon />, action: () => openSidePanel(surface) };
  const detached: SurfaceButton = { label: 'Open in a window', icon: <WindowIcon />, action: () => openDetachedWindow(surface) };
  const close = (label: string): SurfaceButton => ({ label, icon: <CloseIcon />, action: () => closeSurface(surface) });

  const buttons: SurfaceButton[] = {
    popup: [sidePanel, detached],
    panel: [detached, close('Close panel')],
    window: [sidePanel, close('Close window')],
  }[surface];

  async function run(button: SurfaceButton) {
    try {
      await button.action();
      onError('');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'That could not be done.');
    }
  }

  return (
    <div className="surface-buttons">
      {buttons.map((button) => (
        <button key={button.label} className="icon-button surface-button" type="button" aria-label={button.label} title={button.label} onClick={() => void run(button)}>
          {button.icon}
        </button>
      ))}
    </div>
  );
}
