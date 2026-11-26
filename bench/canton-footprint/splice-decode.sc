// Times the load of package signatures that each Splice app does at its start.
// Run it with the splice-node binary of the release: see results/run6/splice-decode.txt.
// VARIANT=release   the code path of the release
// VARIANT=distinct  the same reader, but each package id is decoded one time
// VARIANT=entries   an archive is parsed only when its file name is new
// VARIANT=unzip     every archive is read from its DAR and none is parsed
import org.lfdecentralizedtrust.splice.environment.DarResources
import org.lfdecentralizedtrust.splice.util.ResourceTemplateDecoder
import com.digitalasset.daml.lf.archive.DarReader
import com.digitalasset.daml.lf.typesig
import java.util.zip.ZipInputStream

val resources = DarResources.amulet.all ++ DarResources.TokenStandard.allPackageResources.flatMap(_.all)
// One value for a set of signatures: the package ids in order, each with the text of its signature.
def digest(signatures: Map[String, typesig.PackageSignature]): String = {
  val sha = java.security.MessageDigest.getInstance("SHA-256")
  signatures.toSeq.sortBy(_._1).foreach { case (id, signature) => sha.update(s"$id=$signature\n".getBytes("UTF-8")) }
  sha.digest().take(8).map("%02x".format(_)).mkString
}
val started = System.nanoTime
sys.env("VARIANT") match {
  case "release" =>
    val signatures = ResourceTemplateDecoder.loadPackageSignaturesFromResources(resources)
    println(s"RESULT release dars=${resources.size} signatures=${signatures.size} digest=${digest(signatures.toMap)}")
  case "distinct" =>
    val signatures = scala.collection.mutable.Map.empty[String, typesig.PackageSignature]
    var packages = 0
    resources.foreach { resource =>
      val zip = new ZipInputStream(getClass.getClassLoader.getResourceAsStream(resource.path))
      val dar = DarReader.readArchive(resource.path, zip).fold(error => sys.error(error.toString), identity)
      zip.close()
      dar.all.foreach { archive =>
        packages += 1
        signatures.getOrElseUpdate(archive.pkgId, typesig.reader.SignatureReader.readPackageSignature(archive)._2)
      }
    }
    println(s"RESULT distinct dars=${resources.size} packages=$packages signatures=${signatures.size}")
  case "unzip" =>
    // Reads every archive from every DAR and parses none.
    var packages = 0
    var bytes = 0L
    resources.foreach { resource =>
      val zip = new ZipInputStream(getClass.getClassLoader.getResourceAsStream(resource.path))
      Iterator.continually(zip.getNextEntry).takeWhile(_ != null).filter(_.getName.endsWith(".dalf")).foreach { _ =>
        packages += 1
        bytes += zip.readAllBytes().length
      }
      zip.close()
    }
    println(s"RESULT unzip dars=${resources.size} packages=$packages mib=${bytes / 1048576}")
  case "entries" =>
    // Parses an archive only when no earlier DAR had a file with the same name.
    // The file name of an archive ends with its package id.
    val signatures = scala.collection.mutable.Map.empty[String, typesig.PackageSignature]
    val seen = scala.collection.mutable.Set.empty[String]
    var packages = 0
    resources.foreach { resource =>
      val zip = new ZipInputStream(getClass.getClassLoader.getResourceAsStream(resource.path))
      Iterator.continually(zip.getNextEntry).takeWhile(_ != null).filter(_.getName.endsWith(".dalf")).foreach { entry =>
        packages += 1
        if (seen.add(entry.getName.split('/').last)) {
          val archive = com.digitalasset.daml.lf.archive.ArchiveReader
            .fromByteArray(zip.readAllBytes())
            .fold(error => sys.error(error.toString), identity)
          signatures.update(archive.pkgId, typesig.reader.SignatureReader.readPackageSignature(archive)._2)
        }
      }
      zip.close()
    }
    println(s"RESULT entries dars=${resources.size} packages=$packages parsed=${seen.size} signatures=${signatures.size} digest=${digest(signatures.toMap)}")
}
println(f"SECONDS ${(System.nanoTime - started) / 1e9}%.1f")
