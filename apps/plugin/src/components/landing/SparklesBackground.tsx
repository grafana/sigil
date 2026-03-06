import React from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { PipelineConnectorSwarm } from './PipelineConnectorSwarm';

type SparklesBackgroundProps = {
  className?: string;
  withGradient?: boolean;
  withTopAccent?: boolean;
};

export function SparklesBackground({
  className,
  withGradient = true,
  withTopAccent = false,
}: SparklesBackgroundProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={cx(styles.root, withGradient && styles.gradient, withTopAccent && styles.topAccent, className)}>
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
        maxSparks={6}
      />
      <PipelineConnectorSwarm
        color="#FF9830"
        mode="section"
        className={styles.massiveSwarmSoft}
        delaySec={0.8}
        durationScale={1.8}
        sizeScale={34}
        seed={505}
        maxSparks={4}
      />
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    root: css({
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
    }),
    gradient: css({
      background: theme.isDark
        ? `linear-gradient(145deg, ${theme.colors.background.primary} 0%, rgba(22, 27, 45, 0.95) 50%, ${theme.colors.background.secondary} 100%)`
        : `linear-gradient(145deg, ${theme.colors.background.primary} 0%, ${theme.colors.background.secondary} 100%)`,
    }),
    topAccent: css({
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
    swarm: css({
      position: 'absolute',
      inset: '-8%',
      width: '116%',
      height: '116%',
      '&&': {
        opacity: 0.22,
      },
    }),
    massiveSwarm: css({
      position: 'absolute',
      inset: '-10%',
      width: '120%',
      height: '120%',
      '&&': {
        opacity: 0.14,
      },
    }),
    massiveSwarmSoft: css({
      position: 'absolute',
      inset: '-12%',
      width: '124%',
      height: '124%',
      '&&': {
        opacity: 0.1,
      },
    }),
  };
}
