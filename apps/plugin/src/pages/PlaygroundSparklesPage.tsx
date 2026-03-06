import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { PipelineConnectorSwarm } from '../components/landing/PipelineConnectorSwarm';

export default function PlaygroundSparklesPage() {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.page}>
      <div className={styles.sparklesLayer}>
        <PipelineConnectorSwarm color="#5794F2" mode="section" className={styles.swarm} delaySec={0.1} seed={101} />
        <PipelineConnectorSwarm color="#B877D9" mode="section" className={styles.swarm} delaySec={0.35} seed={202} />
        <PipelineConnectorSwarm color="#FF9830" mode="section" className={styles.swarm} delaySec={0.65} seed={303} />
        <PipelineConnectorSwarm
          color="#B877D9"
          mode="section"
          className={styles.massiveSwarm}
          delaySec={0.2}
          durationScale={1.4}
          sizeScale={24}
          seed={404}
        />
        <PipelineConnectorSwarm
          color="#FF9830"
          mode="section"
          className={styles.massiveSwarmSoft}
          delaySec={0.8}
          durationScale={1.8}
          sizeScale={34}
          seed={505}
        />
      </div>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    page: css({
      position: 'relative',
      width: '100%',
      minHeight: 'calc(100vh - 64px)',
      borderRadius: theme.shape.radius.default,
      overflow: 'hidden',
      background: theme.isDark
        ? `linear-gradient(145deg, ${theme.colors.background.primary} 0%, rgba(22, 27, 45, 0.95) 50%, ${theme.colors.background.secondary} 100%)`
        : `linear-gradient(145deg, ${theme.colors.background.primary} 0%, ${theme.colors.background.secondary} 100%)`,
      border: `1px solid ${theme.colors.border.weak}`,
      '&::before': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        background: 'linear-gradient(90deg, #5794F2 0%, #B877D9 52%, #FF9830 100%)',
        zIndex: 2,
      },
    }),
    sparklesLayer: css({
      position: 'absolute',
      inset: 0,
      zIndex: 1,
      pointerEvents: 'none',
    }),
    swarm: css({
      inset: 0,
      width: '100%',
      height: '100%',
      '&&': {
        opacity: 0.22,
      },
    }),
    massiveSwarm: css({
      inset: 0,
      width: '100%',
      height: '100%',
      '&&': {
        opacity: 0.14,
      },
    }),
    massiveSwarmSoft: css({
      inset: 0,
      width: '100%',
      height: '100%',
      '&&': {
        opacity: 0.1,
      },
    }),
  };
}
