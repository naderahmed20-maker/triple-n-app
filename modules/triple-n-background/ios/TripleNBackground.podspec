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
    'Triple N native module'

  s.description =
    package['description'] ||
    'Triple N native Expo module for iOS'

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

  s.dependency \
    'ExpoModulesCore'
end