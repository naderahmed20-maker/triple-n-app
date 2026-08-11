import {
    StyleSheet,
    View,
} from 'react-native';

import Svg, {
    Path,
} from 'react-native-svg';

type TemplateCameraOutlineProps = {
  maskPath: string;

  width?: number | string;
  height?: number | string;

  strokeColor?: string;
  strokeWidth?: number;

  dashed?: boolean;
};

export default function TemplateCameraOutline({
  maskPath,
  width = '100%',
  height = '100%',
  strokeColor = '#FFFFFF',
  strokeWidth = 12,
  dashed = true,
}: TemplateCameraOutlineProps) {
  return (
    <View
      pointerEvents="none"
      style={styles.container}
    >
      <Svg
        width={width}
        height={height}
        viewBox="0 0 1000 1000"
        preserveAspectRatio="xMidYMid meet"
      >
        <Path
          d={maskPath}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={
            dashed
              ? '22 14'
              : undefined
          }
        />
      </Svg>
    </View>
  );
}

const styles =
  StyleSheet.create({
    container: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
  });