require 'json'

package = JSON.parse(
  File.read(
    File.join(
      __dir__,
      '..',
      'package.json'
    )
  )
)

Pod::Spec.new do |s|
  s.name =
    'TripleNBackground'

  s.module_name =
    'TripleNBackground'

  s.version =
    package['version']

  s.summary =
    package['description'] ||
    'Triple N background processing module'

  s.description =
    package['description'] ||
    'Triple N native iOS background processing module'

  s.license =
    package['license'] ||
    'MIT'

  s.author =
    'Triple N'

  s.homepage =
    'https://triplen.app'

  s.platform =
    :ios,
    '15.1'

  s.source = {
    :path => '.'
  }

  s.static_framework =
    true

  s.swift_version =
    '5.9'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files =
    '**/*.{h,m,mm,swift}'

  s.resources = [
    'models/**/*.onnx',
    'models/**/*.ort'
  ]

  # Secondary EdgeSAM pipeline is not part of production.
  s.exclude_files = [
    'EdgeSamNativeTypes.swift',
    'EdgeSamNativePreprocessor.swift',
    'EdgeSamNativeSessionManager.swift',
    'EdgeSamNativeEncoder.swift',
    'EdgeSamNativePromptBuilder.swift',
    'EdgeSamNativeDecoder.swift',
    'EdgeSamNativeCandidateSelector.swift',
    'EdgeSamNativeMaskRestorer.swift',
    'EdgeSamNativeMaskRefiner.swift',
    'EdgeSamNativeBackgroundUnderstanding.swift',
    'NativeTransparentImageExporter.swift'
  ]

  s.dependency \
    'ExpoModulesCore'

  s.dependency \
    'onnxruntime-objc',
    '1.24.3'
end