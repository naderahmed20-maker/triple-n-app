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
  s.name           = 'TripleNBackground'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'Triple N'
  s.homepage       = 'https://triplen.app'

  s.platforms = {
    :ios => '15.1'
  }

  s.source = {
    :path => '.'
  }

  s.static_framework = true

  s.swift_version = '5.9'

  s.source_files =
    'ios/**/*.{h,m,mm,swift}'

  s.dependency 'ExpoModulesCore'
end