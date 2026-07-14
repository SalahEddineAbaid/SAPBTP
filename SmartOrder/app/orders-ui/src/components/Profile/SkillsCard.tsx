import { motion } from 'framer-motion';
import { Award, Briefcase, Sparkles, CheckCircle, Flame } from 'lucide-react';

export default function SkillsCard() {
  const skills = [
    { name: 'SAP S/4HANA', level: 'Expert', color: 'from-blue-500 to-indigo-600' },
    { name: 'Cloud Computing', level: 'Expert', color: 'from-cyan-500 to-blue-500' },
    { name: 'Big Data', level: 'Intermédiaire', color: 'from-purple-500 to-indigo-500' },
    { name: 'DevOps', level: 'Intermédiaire', color: 'from-pink-500 to-rose-500' },
    { name: 'React', level: 'Expert', color: 'from-sky-400 to-blue-600' },
    { name: 'Spring Boot', level: 'Intermédiaire', color: 'from-emerald-500 to-teal-600' },
  ];

  const certifications = [
    { title: 'SAP Certified Associate', org: 'SAP SE', progress: 100, date: '10/2025', color: 'text-blue-500' },
    { title: 'Azure Fundamentals (AZ-900)', org: 'Microsoft', progress: 100, date: '12/2025', color: 'text-cyan-500' },
    { title: 'AWS Cloud Practitioner', org: 'Amazon Web Services', progress: 85, date: 'En cours', color: 'text-amber-500' },
    { title: 'Google Cloud Digital Leader', org: 'Google Cloud', progress: 40, date: 'En cours', color: 'text-purple-500' }
  ];

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="bg-white dark:bg-[#0f1633]/60 border border-slate-200 dark:border-[#1e2749] rounded-[24px] p-6 shadow-xl backdrop-blur-md"
    >
      <div className="border-b border-slate-100 dark:border-slate-800/80 pb-4 mb-5 flex items-center gap-2">
        <Award size={16} className="text-blue-500" />
        <h3 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">Compétences & Certifications</h3>
      </div>

      <div className="space-y-6">
        {/* Skills Section */}
        <div>
          <h4 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-1">
            <Flame size={12} className="text-amber-500" /> Compétences Clés
          </h4>
          <div className="flex flex-wrap gap-2.5">
            {skills.map((skill) => (
              <motion.span 
                key={skill.name}
                whileHover={{ scale: 1.05, translateY: -2 }}
                className="px-3 py-1.5 bg-slate-50 dark:bg-[#11183c] border border-slate-250/20 dark:border-slate-850/20 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-350 shadow-sm cursor-default flex items-center gap-1.5"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-cyan-400" />
                {skill.name}
              </motion.span>
            ))}
          </div>
        </div>

        {/* Certifications Section */}
        <div>
          <h4 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-1">
            <Sparkles size={12} className="text-blue-500" /> Certifications Professionnelles
          </h4>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {certifications.map((cert) => (
              <div 
                key={cert.title}
                className="p-4 bg-slate-50/50 dark:bg-slate-950/25 border border-slate-200/50 dark:border-slate-800/50 rounded-2xl flex flex-col justify-between hover:shadow-md transition-shadow group"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h5 className="text-xs font-bold text-slate-800 dark:text-white group-hover:text-blue-600 dark:group-hover:text-cyan-400 transition-colors leading-tight">
                      {cert.title}
                    </h5>
                    <p className="text-[9px] text-slate-400 font-semibold">{cert.org} • {cert.date}</p>
                  </div>
                  {cert.progress === 100 ? (
                    <CheckCircle className="text-emerald-500 shrink-0" size={16} />
                  ) : (
                    <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-ping" />
                  )}
                </div>
                
                {/* Progress bar */}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[9px] text-slate-400 font-bold mb-1">
                    <span>Progression</span>
                    <span>{cert.progress}%</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-800 h-1 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${cert.progress === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                      style={{ width: `${cert.progress}%` }} 
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
